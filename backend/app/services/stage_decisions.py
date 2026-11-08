from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import CommercialBrief, CreativeBrief, Project, StageState
from ..services.adaptation_decisions import AdaptationDecisions
from ..services.adaptation_materialization import materialize_adaptation_release
from ..services.media_decisions import MediaDecisionCandidates
from ..services.media_materialization import materialize_media_decision
from ..services.novel_decisions import NovelDecisionCandidates
from ..services.novel_materialization import (
    materialize_novel_chapter,
    materialize_novel_decision,
)


@dataclass
class StageDecisionCandidates:
    adaptation: AdaptationDecisions
    media: MediaDecisionCandidates
    novel: NovelDecisionCandidates


def materialize_stage_decision(
    db: Session,
    project_id: str,
    project: Project,
    stage: StageState,
    stage_key: str,
    *,
    action: str,
    target: str,
    reason: str | None,
    risk_ack: bool,
    candidates: StageDecisionCandidates,
) -> None:
    materialize_novel_chapter(db, project_id, stage, candidates.novel)
    stage.status = target
    stage.version += 1
    stage.stale = False

    novel_handled = materialize_novel_decision(
        db,
        project,
        project_id,
        stage,
        stage_key,
        action=action,
        reason=reason,
        risk_ack=risk_ack,
        candidates=candidates.novel,
    )
    adaptation_handled = materialize_adaptation_release(
        db,
        project,
        project_id,
        stage,
        stage_key,
        action=action,
        decisions=candidates.adaptation,
    )
    media_handled = materialize_media_decision(
        db,
        project,
        project_id,
        stage,
        stage_key,
        action=action,
        reason=reason,
        candidates=candidates.media,
    )

    if not any((novel_handled, adaptation_handled, media_handled)) and (
        stage_key not in {"novelDraft", "continuity", "manuscriptRelease"} or action != "accept"
    ):
        previous_candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        stage.decision = {
            "action": action,
            "reason": reason,
            "risk_ack": risk_ack,
            **(
                {"candidate_job_id": previous_candidate_job_id}
                if action == "accept" and previous_candidate_job_id
                else {}
            ),
        }

    if stage_key == "creativeBrief":
        brief = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if action == "accept" else "draft"
    if stage_key == "commercialBrief":
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if action == "accept" else "draft"
