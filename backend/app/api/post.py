from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import AudioCandidate, EditPackage, ScriptRelease, StageState, VideoCandidate
from ..services.edit_package import (
    MAX_EDIT_PACKAGE_BYTES,
    EditPackageError,
    build_edit_package,
)
from ..services.keyframe_plan import KeyframePlanError, current_shot_plan_release, required_shots
from .common import audit, get_db, project_or_404

router = APIRouter()


class SubtitleEdit(BaseModel):
    srt: str = Field(max_length=2_000_000)


@router.post("/projects/{project_id}/edit-packages", status_code=201)
def create_edit_package(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "post"
        )
    )
    if not stage or stage.status != "running":
        raise HTTPException(409, "post_stage_must_be_started_before_packaging")
    if project.creation_mode != "original":
        raise HTTPException(422, "edit_package_requires_locked_storyboard")
    try:
        plan = current_shot_plan_release(db, project)
    except KeyframePlanError as error:
        raise HTTPException(409, str(error)) from None
    video_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "video"
        )
    )
    if not video_stage or video_stage.status != "accepted":
        raise HTTPException(409, "all_video_shots_must_be_accepted_before_packaging")
    rows = db.scalars(
        select(VideoCandidate).where(
            VideoCandidate.project_id == project_id,
            VideoCandidate.shot_plan_release_id == plan.id,
            VideoCandidate.status == "accepted",
        )
    ).all()
    candidate_map = {(row.episode_number, row.scene_number, row.shot_number): row for row in rows}
    if set(candidate_map) != required_shots(plan):
        raise HTTPException(409, "accepted_video_coverage_changed")
    if sum(row.size_bytes or 0 for row in rows) > MAX_EDIT_PACKAGE_BYTES:
        raise HTTPException(413, "edit_package_exceeds_one_gigabyte_limit")
    script = db.get(ScriptRelease, plan.script_release_id)
    if not script:
        raise HTTPException(409, "locked_script_release_missing")
    audio_map = _accepted_audio_candidates(db, project_id, script)
    previous = db.scalar(
        select(EditPackage.revision)
        .where(EditPackage.project_id == project_id)
        .order_by(EditPackage.revision.desc())
        .limit(1)
    )
    package_id = str(uuid4())
    relative_key = f"generated/{project_id}/edit-package-{package_id}.zip"
    package_path = settings.storage_dir / relative_key
    try:
        result = build_edit_package(
            project_id=project_id,
            plan=plan,
            script=script,
            candidates=candidate_map,
            audio_candidates=audio_map,
            storage_dir=settings.storage_dir,
            output_path=package_path,
        )
    except EditPackageError as error:
        package_path.unlink(missing_ok=True)
        raise HTTPException(409, str(error)) from None
    except OSError:
        package_path.unlink(missing_ok=True)
        raise HTTPException(500, "edit_package_storage_failed") from None
    package = EditPackage(
        id=package_id,
        project_id=project_id,
        branch_id=plan.branch_id,
        shot_plan_release_id=plan.id,
        script_release_id=script.id,
        revision=(previous or 0) + 1,
        storage_key=relative_key,
        size_bytes=result.size_bytes,
        sha256=result.sha256,
        shot_count=result.shot_count,
        subtitle_count=result.subtitle_count,
        subtitle_srt=result.subtitle_srt,
        source_snapshot=result.source_snapshot,
    )
    db.add(package)
    db.flush()
    stage.status = "needs_review"
    stage.version += 1
    stage.stale = False
    stage.decision = {"edit_package_id": package.id, "revision": package.revision}
    audit(
        db,
        project_id,
        "post.edit_package_created",
        package.id,
        {
            "revision": package.revision,
            "shot_count": package.shot_count,
            "subtitle_count": package.subtitle_count,
            "sha256": package.sha256,
        },
    )
    db.commit()
    return _package_payload(project_id, package, include_subtitles=True)


@router.get("/projects/{project_id}/edit-packages/{package_id}")
def get_edit_package(project_id: str, package_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    package = db.scalar(
        select(EditPackage).where(
            EditPackage.id == package_id,
            EditPackage.project_id == project_id,
        )
    )
    if not package:
        raise HTTPException(404, "edit_package_not_found")
    return _package_payload(project_id, package, include_subtitles=True)


@router.put("/projects/{project_id}/edit-packages/{package_id}/subtitles")
def update_edit_package_subtitles(
    project_id: str,
    package_id: str,
    data: SubtitleEdit,
    db: Session = Depends(get_db),
):
    project = project_or_404(db, project_id)
    previous = db.scalar(
        select(EditPackage).where(
            EditPackage.id == package_id,
            EditPackage.project_id == project_id,
            EditPackage.status == "needs_review",
        )
    )
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "post"
        )
    )
    if not previous or not stage or stage.status != "needs_review":
        raise HTTPException(409, "only_current_edit_package_can_be_revised")
    if (stage.decision or {}).get("edit_package_id") != previous.id:
        raise HTTPException(409, "edit_package_is_not_current_review_candidate")
    if project.creation_mode != "original":
        raise HTTPException(422, "edit_package_requires_locked_storyboard")
    try:
        plan = current_shot_plan_release(db, project)
    except KeyframePlanError as error:
        raise HTTPException(409, str(error)) from None
    if plan.id != previous.shot_plan_release_id:
        raise HTTPException(409, "edit_package_source_releases_are_stale")
    candidates = db.scalars(
        select(VideoCandidate).where(
            VideoCandidate.project_id == project_id,
            VideoCandidate.shot_plan_release_id == plan.id,
            VideoCandidate.status == "accepted",
        )
    ).all()
    candidate_map = {
        (item.episode_number, item.scene_number, item.shot_number): item for item in candidates
    }
    if set(candidate_map) != required_shots(plan):
        raise HTTPException(409, "accepted_video_coverage_changed")
    script = db.get(ScriptRelease, plan.script_release_id)
    if not script:
        raise HTTPException(409, "locked_script_release_missing")
    audio_map = _accepted_audio_candidates(db, project_id, script)
    next_revision = previous.revision + 1
    package_id = str(uuid4())
    relative_key = f"generated/{project_id}/edit-package-{package_id}.zip"
    package_path = settings.storage_dir / relative_key
    try:
        result = build_edit_package(
            project_id=project_id,
            plan=plan,
            script=script,
            candidates=candidate_map,
            audio_candidates=audio_map,
            storage_dir=settings.storage_dir,
            output_path=package_path,
            subtitle_override=data.srt,
        )
    except EditPackageError as error:
        package_path.unlink(missing_ok=True)
        raise HTTPException(422, str(error)) from None
    except OSError:
        package_path.unlink(missing_ok=True)
        raise HTTPException(500, "edit_package_storage_failed") from None
    package = EditPackage(
        id=package_id,
        project_id=project_id,
        branch_id=plan.branch_id,
        shot_plan_release_id=plan.id,
        script_release_id=script.id,
        revision=next_revision,
        storage_key=relative_key,
        size_bytes=result.size_bytes,
        sha256=result.sha256,
        shot_count=result.shot_count,
        subtitle_count=result.subtitle_count,
        subtitle_srt=result.subtitle_srt,
        source_snapshot=result.source_snapshot,
    )
    previous.status = "superseded"
    db.add(package)
    db.flush()
    stage.decision = {"edit_package_id": package.id, "revision": package.revision}
    audit(
        db,
        project_id,
        "post.edit_package_revised",
        package.id,
        {"previous_package_id": previous.id, "revision": package.revision},
    )
    db.commit()
    return _package_payload(project_id, package, include_subtitles=True)


@router.get("/projects/{project_id}/edit-packages")
def list_edit_packages(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(
        select(EditPackage)
        .where(EditPackage.project_id == project_id)
        .order_by(EditPackage.revision.desc())
    ).all()
    return [_package_payload(project_id, package) for package in rows]


@router.get("/projects/{project_id}/edit-packages/{package_id}/file")
def get_edit_package_file(project_id: str, package_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    package = db.scalar(
        select(EditPackage).where(
            EditPackage.id == package_id,
            EditPackage.project_id == project_id,
        )
    )
    if not package:
        raise HTTPException(404, "edit_package_not_found")
    path = (settings.storage_dir / package.storage_key).resolve()
    if settings.storage_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "edit_package_file_not_found")
    filename = f"edit-package-v{package.revision:02}.zip"
    return FileResponse(path, media_type="application/zip", filename=filename)


def _package_payload(
    project_id: str, package: EditPackage, *, include_subtitles: bool = False
) -> dict:
    payload = {
        "id": package.id,
        "revision": package.revision,
        "shot_count": package.shot_count,
        "subtitle_count": package.subtitle_count,
        "audio_count": len((package.source_snapshot or {}).get("audio_candidate_ids", [])),
        "size_bytes": package.size_bytes,
        "sha256": package.sha256,
        "source_snapshot": package.source_snapshot,
        "status": package.status,
        "created_at": package.created_at,
        "file_url": f"/api/projects/{project_id}/edit-packages/{package.id}/file",
    }
    if include_subtitles:
        payload["subtitle_srt"] = package.subtitle_srt
    return payload


def _accepted_audio_candidates(
    db: Session, project_id: str, script: ScriptRelease
) -> dict[tuple[int, int, int], AudioCandidate]:
    rows = db.scalars(
        select(AudioCandidate).where(
            AudioCandidate.project_id == project_id,
            AudioCandidate.script_release_id == script.id,
            AudioCandidate.status == "accepted",
        )
    ).all()
    candidate_map = {
        (row.episode_number, row.scene_number, row.dialogue_number): row for row in rows
    }
    required = {
        (episode["episode_number"], scene["scene_number"], line["dialogue_number"])
        for episode in script.episodes
        for scene in episode["scenes"]
        for line in scene["dialogues"]
    }
    if set(candidate_map) != required:
        raise HTTPException(409, "all_script_dialogue_audio_must_be_accepted_before_packaging")
    return candidate_map
