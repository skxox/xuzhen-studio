from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    Chapter,
    CommercialBrief,
    CommercialMaterial,
    CreativeBrief,
    StageState,
)
from .common import (
    ALLOWED,
    audit,
    get_db,
    invalidate_downstream_stages,
    project_or_404,
    refresh_ready_stages,
    stage_dependencies,
)
from .schemas import (
    GateDecision,
)

router = APIRouter()


@router.post("/projects/{project_id}/stages/{stage_key}/decision")
def decide_stage(
    project_id: str, stage_key: str, data: GateDecision, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == stage_key
        )
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status != "needs_review":
        raise HTTPException(409, "stage_must_be_in_needs_review_before_decision")
    if stage_key == "creativeBrief" and data.action == "waive":
        raise HTTPException(422, "creative_brief_cannot_be_waived")
    if stage_key == "commercialBrief" and data.action == "waive":
        raise HTTPException(422, "commercial_brief_cannot_be_waived")
    if data.action in {"waive", "reject"} and not data.reason:
        raise HTTPException(422, "reason_required")
    if data.action == "waive" and not data.risk_ack:
        raise HTTPException(422, "risk_ack_required")
    targets = {"accept": "accepted", "waive": "waived", "reject": "blocked"}
    target = targets[data.action]
    if target not in ALLOWED.get(stage.status, set()):
        raise HTTPException(409, f"invalid_transition:{stage.status}->{target}")
    if data.action in {"accept", "waive"}:
        deps = stage_dependencies(project, stage_key)
        dep_states = {
            s.stage_key: s.status
            for s in db.scalars(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key.in_(deps)
                )
            ).all()
        }
        missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
        if missing:
            raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
    if stage_key == "source" and data.action == "accept" and project.creation_mode == "adaptation":
        if not db.scalar(select(Chapter.id).where(Chapter.project_id == project_id)):
            raise HTTPException(422, "source_requires_at_least_one_chapter")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "source_rights_must_be_recorded")
    if stage_key == "manuscriptRelease" and data.action == "accept":
        chapter_count = len(
            db.scalars(select(Chapter.id).where(Chapter.project_id == project_id)).all()
        )
        if chapter_count < 2:
            raise HTTPException(422, "manuscript_release_requires_at_least_two_chapters")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "original_work_rights_must_be_recorded")
    stage.status = target
    stage.version += 1
    stage.stale = False
    stage.decision = {"action": data.action, "reason": data.reason, "risk_ack": data.risk_ack}
    if stage_key == "creativeBrief":
        brief = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if data.action == "accept" else "draft"
    if stage_key == "commercialBrief":
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if data.action == "accept" else "draft"
    if data.action in {"accept", "waive"}:
        refresh_ready_stages(db, project)
    audit(db, project_id, "stage.decision", stage.id, stage.decision)
    db.commit()
    return {
        "id": stage.id,
        "stage_key": stage_key,
        "status": stage.status,
        "version": stage.version,
        "decision": stage.decision,
    }


@router.post("/projects/{project_id}/stages/{stage_key}/start")
def start_stage(project_id: str, stage_key: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == stage_key
        )
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status not in {"ready", "accepted", "waived", "stale", "failed"}:
        raise HTTPException(409, f"stage_cannot_start_from:{stage.status}")
    project = project_or_404(db, project_id)
    deps = stage_dependencies(project, stage_key)
    dep_states = {
        s.stage_key: s.status
        for s in db.scalars(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key.in_(deps)
            )
        ).all()
    }
    missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
    if missing:
        raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
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
