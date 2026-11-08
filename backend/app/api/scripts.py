from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import AdaptationBranch, ScriptRelease, StageState
from .common import get_db, project_or_404

router = APIRouter()


@router.get("/projects/{project_id}/script-releases")
def list_script_releases(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    script_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id,
            StageState.stage_key == "script",
        )
    )
    current_release_id = (
        (script_stage.decision or {}).get("script_release_id")
        if script_stage and script_stage.status == "accepted"
        else None
    )
    releases = db.scalars(
        select(ScriptRelease)
        .join(AdaptationBranch, ScriptRelease.branch_id == AdaptationBranch.id)
        .where(AdaptationBranch.project_id == project_id)
        .order_by(ScriptRelease.revision.desc())
    ).all()
    return [
        {
            "id": release.id,
            "branch_id": release.branch_id,
            "outline_release_id": release.outline_release_id,
            "revision": release.revision,
            "job_id": release.job_id,
            "character_job_id": release.character_job_id,
            "art_job_id": release.art_job_id,
            "episode_count": release.episode_count,
            "episodes": release.episodes,
            "is_current": release.id == current_release_id,
            "created_at": release.created_at,
        }
        for release in releases
    ]
