from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    AdaptationBranch,
    KeyframeCandidate,
    ShotPlanRelease,
    StageState,
    VideoCandidate,
)
from .common import get_db, project_or_404

router = APIRouter()


@router.get("/projects/{project_id}/shot-plan-releases")
def list_shot_plan_releases(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "shotDesign"
        )
    )
    current_id = (
        (stage.decision or {}).get("shot_plan_release_id")
        if stage and stage.status == "accepted"
        else None
    )
    releases = db.scalars(
        select(ShotPlanRelease)
        .join(AdaptationBranch, ShotPlanRelease.branch_id == AdaptationBranch.id)
        .where(AdaptationBranch.project_id == project_id)
        .order_by(ShotPlanRelease.revision.desc())
    ).all()
    return [
        {
            "id": release.id,
            "branch_id": release.branch_id,
            "script_release_id": release.script_release_id,
            "revision": release.revision,
            "job_id": release.job_id,
            "character_job_id": release.character_job_id,
            "art_job_id": release.art_job_id,
            "episode_count": release.episode_count,
            "shot_count": release.shot_count,
            "episodes": release.episodes,
            "is_current": release.id == current_id,
            "created_at": release.created_at,
        }
        for release in releases
    ]


@router.get("/projects/{project_id}/keyframe-candidates")
def list_keyframe_candidates(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(
        select(KeyframeCandidate)
        .where(KeyframeCandidate.project_id == project_id)
        .order_by(KeyframeCandidate.created_at.desc())
    ).all()
    return [
        {
            "id": row.id,
            "branch_id": row.branch_id,
            "shot_plan_release_id": row.shot_plan_release_id,
            "job_id": row.job_id,
            "episode_number": row.episode_number,
            "scene_number": row.scene_number,
            "shot_number": row.shot_number,
            "storage_key": row.storage_key,
            "content_type": row.content_type,
            "size_bytes": row.size_bytes,
            "sha256": row.sha256,
            "prompt": row.prompt,
            "provider_snapshot": row.provider_snapshot,
            "status": row.status,
            "created_at": row.created_at,
            "file_url": f"/api/projects/{project_id}/keyframe-candidates/{row.id}/file",
        }
        for row in rows
    ]


@router.get("/projects/{project_id}/keyframe-candidates/{candidate_id}/file")
def get_keyframe_file(project_id: str, candidate_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    candidate = db.scalar(
        select(KeyframeCandidate).where(
            KeyframeCandidate.id == candidate_id,
            KeyframeCandidate.project_id == project_id,
        )
    )
    if not candidate:
        raise HTTPException(404, "keyframe_candidate_not_found")
    path = (settings.storage_dir / candidate.storage_key).resolve()
    if settings.storage_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "keyframe_file_not_found")
    return FileResponse(path, media_type=candidate.content_type)


@router.get("/projects/{project_id}/video-candidates")
def list_video_candidates(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(
        select(VideoCandidate)
        .where(VideoCandidate.project_id == project_id)
        .order_by(VideoCandidate.created_at.desc())
    ).all()
    return [
        {
            "id": row.id,
            "branch_id": row.branch_id,
            "shot_plan_release_id": row.shot_plan_release_id,
            "keyframe_candidate_id": row.keyframe_candidate_id,
            "job_id": row.job_id,
            "provider_task_id": row.provider_task_id,
            "episode_number": row.episode_number,
            "scene_number": row.scene_number,
            "shot_number": row.shot_number,
            "requested_seconds": row.requested_seconds,
            "progress": row.progress,
            "storage_key": row.storage_key,
            "content_type": row.content_type,
            "size_bytes": row.size_bytes,
            "sha256": row.sha256,
            "prompt": row.prompt,
            "provider_snapshot": row.provider_snapshot,
            "error": row.error,
            "status": row.status,
            "created_at": row.created_at,
            "file_url": (
                f"/api/projects/{project_id}/video-candidates/{row.id}/file"
                if row.storage_key
                else None
            ),
        }
        for row in rows
    ]


@router.get("/projects/{project_id}/video-candidates/{candidate_id}/file")
def get_video_file(project_id: str, candidate_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    candidate = db.scalar(
        select(VideoCandidate).where(
            VideoCandidate.id == candidate_id,
            VideoCandidate.project_id == project_id,
        )
    )
    if not candidate or not candidate.storage_key:
        raise HTTPException(404, "video_candidate_file_not_found")
    path = (settings.storage_dir / candidate.storage_key).resolve()
    if settings.storage_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "video_candidate_file_not_found")
    return FileResponse(path, media_type="video/mp4", filename=f"shot-{candidate.id}.mp4")
