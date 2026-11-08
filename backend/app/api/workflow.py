from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import Chapter, StageState
from ..services.adaptation_decisions import (
    AdaptationDecisionError,
    AdaptationDecisions,
    validate_adaptation_decision,
    validate_asset_decision,
)
from ..services.media_decisions import MediaDecisionError, validate_media_decision
from ..services.novel_decisions import NovelDecisionError, validate_novel_decision
from ..services.stage_decisions import StageDecisionCandidates, materialize_stage_decision
from ..services.workflow_policy import StageDecisionPolicyError, validate_stage_decision
from .common import (
    audit,
    get_db,
    project_or_404,
    refresh_ready_stages,
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
        select(StageState)
        .where(StageState.project_id == project_id, StageState.stage_key == stage_key)
        .with_for_update()
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    try:
        target = validate_stage_decision(
            db,
            project,
            stage,
            stage_key,
            action=data.action,
            reason=data.reason,
            risk_ack=data.risk_ack,
        )
    except StageDecisionPolicyError as error:
        raise HTTPException(error.status_code, error.detail) from None
    if stage_key == "source" and data.action == "accept" and project.creation_mode == "adaptation":
        if not db.scalar(select(Chapter.id).where(Chapter.project_id == project_id)):
            raise HTTPException(422, "source_requires_at_least_one_chapter")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "source_rights_must_be_recorded")
    try:
        adaptation_decisions = (
            validate_adaptation_decision(db, project, stage, stage_key)
            if data.action == "accept"
            else AdaptationDecisions()
        )
    except AdaptationDecisionError as error:
        raise HTTPException(error.status_code, error.detail) from None
    try:
        media_candidates = validate_media_decision(db, project, stage, stage_key)
    except MediaDecisionError as error:
        raise HTTPException(409, error.detail) from None
    if data.action == "accept":
        try:
            validate_asset_decision(db, project, stage, stage_key)
        except AdaptationDecisionError as error:
            raise HTTPException(error.status_code, error.detail) from None
    try:
        novel_decisions = validate_novel_decision(
            db,
            project,
            stage,
            stage_key,
            action=data.action,
            risk_ack=data.risk_ack,
            reason=data.reason,
        )
    except NovelDecisionError as error:
        raise HTTPException(error.status_code, error.detail) from None
    materialize_stage_decision(
        db,
        project_id,
        project,
        stage,
        stage_key,
        action=data.action,
        target=target,
        reason=data.reason,
        risk_ack=data.risk_ack,
        candidates=StageDecisionCandidates(
            adaptation=adaptation_decisions,
            media=media_candidates,
            novel=novel_decisions,
        ),
    )
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
