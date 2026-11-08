from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import DeliveryMaster, EditPackage, StageState
from ..services.ffmpeg_master import (
    MasterRenderError,
    ffmpeg_available,
    render_master,
)
from ..services.media_quality import ffprobe_available
from .common import audit, get_db, project_or_404

router = APIRouter()


@router.get("/delivery/runtime")
def get_delivery_runtime():
    ffmpeg_ok = ffmpeg_available(settings.ffmpeg_binary)
    ffprobe_ok = ffprobe_available(settings.ffprobe_binary)
    available = ffmpeg_ok and ffprobe_ok
    return {
        "master_render_available": available,
        "ffmpeg_available": ffmpeg_ok,
        "ffprobe_available": ffprobe_ok,
        "message": (
            None
            if available
            else (
                "最终成片需要 FFmpeg（libx264、aac、mov_text）和 FFprobe。"
                "macOS 可运行 brew install ffmpeg，然后重启 API 服务。"
            )
        ),
    }


@router.get("/projects/{project_id}/delivery-masters")
def list_delivery_masters(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(
        select(DeliveryMaster)
        .where(DeliveryMaster.project_id == project_id)
        .order_by(DeliveryMaster.revision.desc())
    ).all()
    return [_master_payload(project_id, master) for master in rows]


@router.post("/projects/{project_id}/delivery-masters", status_code=201)
def create_delivery_master(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "original":
        raise HTTPException(422, "master_render_requires_locked_original_script")
    if project.rights_status not in {"owned", "licensed", "public_domain"}:
        raise HTTPException(409, "delivery_rights_confirmation_required")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "delivery"
        )
    )
    post_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "post"
        )
    )
    if not stage or stage.status != "running":
        raise HTTPException(409, "delivery_stage_must_be_started_before_rendering")
    if not post_stage or post_stage.status != "accepted":
        raise HTTPException(409, "accepted_post_package_required")
    package_id = (post_stage.decision or {}).get("edit_package_id")
    package = db.scalar(
        select(EditPackage).where(
            EditPackage.id == package_id,
            EditPackage.project_id == project_id,
            EditPackage.status == "accepted",
        )
    )
    if not package:
        raise HTTPException(409, "accepted_edit_package_missing")
    package_path = (settings.storage_dir / package.storage_key).resolve()
    if settings.storage_dir.resolve() not in package_path.parents or not package_path.is_file():
        raise HTTPException(409, "accepted_edit_package_file_missing")
    revision = db.scalar(
        select(DeliveryMaster.revision)
        .where(DeliveryMaster.project_id == project_id)
        .order_by(DeliveryMaster.revision.desc())
        .limit(1)
    )
    master_id = str(uuid4())
    relative_key = f"generated/{project_id}/master-{master_id}.mp4"
    output_path = settings.storage_dir / relative_key
    try:
        result = render_master(
            package_path=package_path,
            output_path=output_path,
            aspect_ratio=project.aspect_ratio,
            ffmpeg_binary=settings.ffmpeg_binary,
            ffprobe_binary=settings.ffprobe_binary,
            expected_package_sha256=package.sha256,
        )
    except MasterRenderError as error:
        output_path.unlink(missing_ok=True)
        if str(error) in {"ffmpeg_unavailable", "ffprobe_unavailable"}:
            raise HTTPException(503, str(error)) from None
        stage.status = "failed"
        stage.version += 1
        audit(db, project_id, "delivery.master_render_failed", stage.id, {"code": str(error)})
        db.commit()
        raise HTTPException(422, str(error)) from None
    master = DeliveryMaster(
        id=master_id,
        project_id=project_id,
        edit_package_id=package.id,
        revision=(revision or 0) + 1,
        storage_key=relative_key,
        size_bytes=result.size_bytes,
        sha256=result.sha256,
        duration_seconds=result.duration_seconds,
        width=result.width,
        height=result.height,
        source_snapshot={
            "edit_package_id": package.id,
            "edit_package_revision": package.revision,
            "edit_package_sha256": package.sha256,
            "rights_status": project.rights_status,
            "timing_basis": "requested_clip_durations",
            "audio_sync_basis": "srt_cue_start_with_ffprobe_duration_fit",
            "video_sync_basis": "ffprobe_normalized_to_requested_duration_with_tail_freeze",
            "render_profile": {
                "video_codec": "libx264",
                "video_crf": 20,
                "frame_rate": 30,
                "audio_codec": "aac",
                "audio_bitrate": "192k",
                "subtitle_codec": "mov_text",
            },
            "quality_report": result.quality_report,
        },
    )
    db.add(master)
    db.flush()
    stage.status = "needs_review"
    stage.version += 1
    stage.stale = False
    stage.decision = {"delivery_master_id": master.id, "revision": master.revision}
    audit(
        db,
        project_id,
        "delivery.master_created",
        master.id,
        {
            "revision": master.revision,
            "edit_package_id": package.id,
            "size_bytes": master.size_bytes,
            "sha256": master.sha256,
            "duration_seconds": master.duration_seconds,
            "quality_passed": result.quality_report["passed"],
        },
    )
    db.commit()
    return _master_payload(project_id, master)


@router.get("/projects/{project_id}/delivery-masters/{master_id}/file")
def get_delivery_master_file(project_id: str, master_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    master = db.scalar(
        select(DeliveryMaster).where(
            DeliveryMaster.id == master_id,
            DeliveryMaster.project_id == project_id,
        )
    )
    if not master:
        raise HTTPException(404, "delivery_master_not_found")
    path = (settings.storage_dir / master.storage_key).resolve()
    if settings.storage_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "delivery_master_file_not_found")
    return FileResponse(path, media_type="video/mp4", filename=f"master-v{master.revision:02}.mp4")


def _master_payload(project_id: str, master: DeliveryMaster) -> dict:
    return {
        "id": master.id,
        "revision": master.revision,
        "edit_package_id": master.edit_package_id,
        "size_bytes": master.size_bytes,
        "sha256": master.sha256,
        "duration_seconds": master.duration_seconds,
        "width": master.width,
        "height": master.height,
        "source_snapshot": master.source_snapshot,
        "status": master.status,
        "created_at": master.created_at,
        "file_url": f"/api/projects/{project_id}/delivery-masters/{master.id}/file",
    }
