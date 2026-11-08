from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import AdaptationBranch, ShotPlanRelease, StageState
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
