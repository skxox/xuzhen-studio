from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    Chapter,
    CommercialBrief,
    CommercialMaterial,
    CreativeBrief,
    KeyframeCandidate,
    StageState,
)
from ..services.keyframe_plan import KeyframePlanError, current_shot_plan_release, required_shots
from .common import audit, get_db, invalidate_downstream_stages, project_or_404, stage_dependencies

router = APIRouter()


@router.post("/projects/{project_id}/stages/{stage_key}/start")
def start_stage(project_id: str, stage_key: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == stage_key
        )
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status not in {"ready", "accepted", "waived", "stale", "failed", "blocked"}:
        raise HTTPException(409, f"stage_cannot_start_from:{stage.status}")
    deps = stage_dependencies(project, stage_key)
    dep_states = {
        item.stage_key: item.status
        for item in db.scalars(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key.in_(deps)
            )
        ).all()
    }
    missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
    if missing:
        raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
    if stage_key == "video" and project.creation_mode == "original":
        try:
            release = current_shot_plan_release(db, project)
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        accepted = db.scalars(
            select(KeyframeCandidate).where(
                KeyframeCandidate.project_id == project_id,
                KeyframeCandidate.shot_plan_release_id == release.id,
                KeyframeCandidate.status == "accepted",
            )
        ).all()
        accepted_shots = {
            (item.episode_number, item.scene_number, item.shot_number) for item in accepted
        }
        if accepted_shots != required_shots(release):
            raise HTTPException(409, "all_shot_keyframes_must_be_accepted_before_video")
    stage.status = "running"
    stage.version += 1
    stage.stale = False
    stage.decision = {}
    invalidate_downstream_stages(db, project, stage_key)
    audit(
        db,
        project_id,
        "stage.started",
        stage.id,
        {"stage_key": stage_key, "version": stage.version},
    )
    db.commit()
    return {
        "id": stage.id,
        "stage_key": stage_key,
        "status": stage.status,
        "version": stage.version,
    }


@router.post("/projects/{project_id}/stages/{stage_key}/submit-review")
def submit_stage_review(project_id: str, stage_key: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == stage_key
        )
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status != "running":
        raise HTTPException(409, "stage_must_be_running")
    if stage_key == "source":
        if not db.scalar(select(Chapter.id).where(Chapter.project_id == project_id)):
            raise HTTPException(422, "source_requires_at_least_one_chapter")
    if stage_key == "creativeBrief":
        brief = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
        if not brief:
            raise HTTPException(422, "creative_brief_must_be_saved_before_review")
        if not brief.rights_confirmed:
            raise HTTPException(422, "creative_brief_rights_must_be_confirmed")
        brief.status = "needs_review"
    if stage_key == "commercialBrief":
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if not brief:
            raise HTTPException(422, "commercial_brief_must_be_saved_before_review")
        if not brief.rights_confirmed:
            raise HTTPException(422, "commercial_brief_rights_must_be_confirmed")
        if not db.scalar(
            select(CommercialMaterial.id).where(CommercialMaterial.project_id == project_id)
        ):
            raise HTTPException(422, "commercial_brief_requires_at_least_one_material")
        brief.status = "needs_review"
    stage.status = "needs_review"
    audit(
        db,
        project_id,
        "stage.submitted_for_review",
        stage.id,
        {"stage_key": stage_key, "version": stage.version},
    )
    db.commit()
    return {
        "id": stage.id,
        "stage_key": stage_key,
        "status": stage.status,
        "version": stage.version,
    }
