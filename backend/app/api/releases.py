from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import ManuscriptRelease, StageState
from .common import get_db, project_or_404

router = APIRouter()


@router.get("/projects/{project_id}/manuscript-releases")
def list_manuscript_releases(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    release_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id,
            StageState.stage_key == "manuscriptRelease",
        )
    )
    current_release_id = (
        (release_stage.decision or {}).get("release_id")
        if release_stage and release_stage.status == "accepted"
        else None
    )
    releases = db.scalars(
        select(ManuscriptRelease)
        .where(ManuscriptRelease.project_id == project_id)
        .order_by(ManuscriptRelease.revision.desc())
    ).all()
    return [serialize_release(item, item.id == current_release_id) for item in releases]


@router.get("/projects/{project_id}/manuscript-releases/{release_id}")
def get_manuscript_release(project_id: str, release_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    release = db.scalar(
        select(ManuscriptRelease).where(
            ManuscriptRelease.project_id == project_id,
            ManuscriptRelease.id == release_id,
        )
    )
    if not release:
        raise HTTPException(404, "manuscript_release_not_found")
    release_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id,
            StageState.stage_key == "manuscriptRelease",
        )
    )
    current_release_id = (
        (release_stage.decision or {}).get("release_id")
        if release_stage and release_stage.status == "accepted"
        else None
    )
    return serialize_release(release, release.id == current_release_id)


def serialize_release(release: ManuscriptRelease, is_current: bool) -> dict:
    return {
        "id": release.id,
        "revision": release.revision,
        "project_id": release.project_id,
        "chapter_start": release.chapter_start,
        "chapter_end": release.chapter_end,
        "chapter_versions": release.chapter_versions,
        "continuity_job_id": release.continuity_job_id,
        "continuity_revision": release.continuity_revision,
        "rights_status": release.rights_status,
        "risk_ack": release.risk_ack,
        "decision_reason": release.decision_reason,
        "previous_release_id": release.previous_release_id,
        "is_current": is_current,
        "created_at": release.created_at,
    }
