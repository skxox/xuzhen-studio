import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    Chapter,
    CommercialBrief,
    CommercialMaterial,
    CreativeBrief,
    GenerationJob,
    GenerationOutput,
    StageState,
)
from ..services.continuity import (
    ContinuityReportError,
    parse_continuity_report,
    unresolved_high_findings,
    unresolved_medium_findings,
)
from ..services.novel_draft import NovelDraftCandidateError, parse_chapter_candidate
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
    if stage_key in {"continuity", "manuscriptRelease"} and data.action == "waive":
        raise HTTPException(422, "novel_quality_gates_cannot_be_waived")
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
    continuity_decision = None
    release_decision = None
    if stage_key == "continuity" and data.action == "accept":
        continuity_decision = _validated_continuity_decision(db, project_id, stage)
        report = continuity_decision["report"]
        high_open = unresolved_high_findings(report)
        if high_open:
            raise HTTPException(
                422,
                {"code": "high_severity_findings_must_be_resolved", "finding_ids": high_open},
            )
        medium_open = unresolved_medium_findings(report)
        if medium_open and (not data.risk_ack or not data.reason or not data.reason.strip()):
            raise HTTPException(
                422,
                {
                    "code": "open_medium_findings_require_risk_acknowledgement",
                    "finding_ids": medium_open,
                },
            )
        accepted_risk = [
            finding.finding_id for finding in report.findings if finding.status == "accepted_risk"
        ]
        if accepted_risk and (not data.risk_ack or not data.reason or not data.reason.strip()):
            raise HTTPException(422, "accepted_risk_findings_require_reason_and_risk_ack")
    if stage_key == "manuscriptRelease" and data.action == "accept":
        if project.creation_mode != "original":
            raise HTTPException(422, "manuscript_release_requires_original_project")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "original_work_rights_must_be_recorded")
        continuity_stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == "continuity"
            )
        )
        if not continuity_stage or continuity_stage.status != "accepted":
            raise HTTPException(409, "accepted_continuity_report_required")
        continuity_decision = _validated_continuity_decision(db, project_id, continuity_stage)
        report = continuity_decision["report"]
        if unresolved_high_findings(report):
            raise HTTPException(422, "high_severity_findings_must_be_resolved")
        start, end = report.chapter_start, report.chapter_end
        latest_chapters = _latest_chapters(db, project_id)
        scoped_chapters = [
            latest_chapters[ordinal]
            for ordinal in range(start, end + 1)
            if ordinal in latest_chapters
        ]
        if len(scoped_chapters) != end - start + 1:
            raise HTTPException(409, "manuscript_release_scope_is_not_contiguous")
        if len(scoped_chapters) < 2:
            raise HTTPException(422, "manuscript_release_requires_at_least_two_chapters")
        release_decision = {
            "action": "accept",
            "continuity_job_id": continuity_decision["job"].id,
            "continuity_report_revision": continuity_decision["output"].revision,
            "chapter_start": start,
            "chapter_end": end,
            "continuity_risk_ack": (continuity_stage.decision or {}).get("risk_ack", False),
            "chapter_versions": [
                {"ordinal": item.ordinal, "chapter_id": item.id, "version": item.version}
                for item in scoped_chapters
            ],
        }
    chapter_candidate = None
    candidate_job = None
    if stage_key == "novelDraft" and data.action == "accept":
        if project.creation_mode != "original":
            raise HTTPException(422, "novel_draft_requires_original_project")
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == "novelDraft",
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        expected_ordinal = (
            (candidate_job.input_snapshot.get("scope") or {}).get("chapter_ordinal")
            if candidate_job
            else None
        )
        if not output or not isinstance(expected_ordinal, int):
            raise HTTPException(409, "novel_chapter_candidate_missing")
        try:
            chapter_candidate = parse_chapter_candidate(output.content, expected_ordinal)
        except NovelDraftCandidateError as error:
            raise HTTPException(422, str(error)) from None
        previous_versions = db.scalars(
            select(Chapter.version).where(
                Chapter.project_id == project_id, Chapter.ordinal == expected_ordinal
            )
        ).all()
        chapter = Chapter(
            project_id=project_id,
            ordinal=chapter_candidate.ordinal,
            title=chapter_candidate.title,
            body=chapter_candidate.body,
            content_hash=hashlib.sha256(chapter_candidate.body.encode("utf-8")).hexdigest(),
            version=max(previous_versions, default=0) + 1,
            source_name=f"ai-job:{candidate_job.id}",
        )
        db.add(chapter)
        db.flush()
        stage.decision = {
            "action": "accept",
            "candidate_job_id": candidate_job.id,
            "chapter_id": chapter.id,
            "chapter_ordinal": chapter.ordinal,
            "chapter_version": chapter.version,
        }
        audit(
            db,
            project_id,
            "chapter.generated_accepted",
            chapter.id,
            {
                "job_id": candidate_job.id,
                "ordinal": chapter.ordinal,
                "version": chapter.version,
                "content_hash": chapter.content_hash,
            },
        )
    stage.status = target
    stage.version += 1
    stage.stale = False
    if stage_key == "continuity" and data.action == "accept" and continuity_decision:
        report = continuity_decision["report"]
        stage.decision = {
            "action": "accept",
            "candidate_job_id": continuity_decision["job"].id,
            "report_revision": continuity_decision["output"].revision,
            "chapter_start": report.chapter_start,
            "chapter_end": report.chapter_end,
            "risk_ack": data.risk_ack,
            "reason": data.reason,
        }
        audit(
            db,
            project_id,
            "continuity.report_accepted",
            stage.id,
            {
                "candidate_job_id": continuity_decision["job"].id,
                "chapter_start": report.chapter_start,
                "chapter_end": report.chapter_end,
                "finding_count": len(report.findings),
            },
        )
    elif stage_key == "manuscriptRelease" and data.action == "accept" and release_decision:
        stage.decision = release_decision
        audit(db, project_id, "manuscript.release_locked", stage.id, release_decision)
    elif (
        stage_key not in {"novelDraft", "continuity", "manuscriptRelease"}
        or data.action != "accept"
    ):
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
    if stage.status not in {"ready", "accepted", "waived", "stale", "failed", "blocked"}:
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


def _latest_chapters(db: Session, project_id: str) -> dict[int, Chapter]:
    items = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.ordinal, Chapter.version.desc())
    ).all()
    latest: dict[int, Chapter] = {}
    for item in items:
        latest.setdefault(item.ordinal, item)
    return latest


def _validated_continuity_decision(db: Session, project_id: str, stage: StageState) -> dict:
    candidate_job_id = (stage.decision or {}).get("candidate_job_id")
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == candidate_job_id,
            GenerationJob.project_id == project_id,
            GenerationJob.stage_key == "continuity",
            GenerationJob.status == "succeeded",
        )
    )
    output = (
        db.scalar(
            select(GenerationOutput).where(
                GenerationOutput.project_id == project_id,
                GenerationOutput.job_id == candidate_job_id,
            )
        )
        if job
        else None
    )
    if not job or not output:
        raise HTTPException(409, "continuity_report_candidate_missing")
    scope = job.input_snapshot.get("scope") or {}
    chapter_start = scope.get("chapter_start")
    chapter_end = scope.get("chapter_end")
    if type(chapter_start) is not int or type(chapter_end) is not int:
        raise HTTPException(409, "continuity_report_scope_missing")
    chapters = _latest_chapters(db, project_id)
    chapter_texts = {
        ordinal: chapters[ordinal].body
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in chapters
    }
    context_ordinal = scope.get("context_chapter")
    if type(context_ordinal) is int:
        if context_ordinal not in chapters:
            raise HTTPException(409, "continuity_report_context_chapter_changed")
        chapter_texts[context_ordinal] = chapters[context_ordinal].body
    latest_ids = {
        chapters[ordinal].id
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in chapters
    }
    if type(context_ordinal) is int and context_ordinal in chapters:
        latest_ids.add(chapters[context_ordinal].id)
    if not latest_ids.issubset(set(job.input_snapshot.get("input_refs", []))):
        raise HTTPException(409, "continuity_report_chapter_versions_changed")
    try:
        report = parse_continuity_report(
            output.content,
            chapter_start,
            chapter_end,
            chapter_texts,
            allow_review_decisions=True,
        )
    except ContinuityReportError as error:
        raise HTTPException(422, str(error)) from None
    return {"job": job, "output": output, "report": report}
