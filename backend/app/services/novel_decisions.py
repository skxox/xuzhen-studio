from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.contracts import ContinuityReportCandidate, NovelChapterDraftCandidate
from ..domain.models import Chapter, GenerationJob, GenerationOutput, Project, StageState
from .continuity import (
    ContinuityReportError,
    parse_continuity_report,
    unresolved_high_findings,
    unresolved_medium_findings,
)
from .novel_draft import NovelDraftCandidateError, parse_chapter_candidate


class NovelDecisionError(Exception):
    def __init__(self, status_code: int, detail: object):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


@dataclass
class ValidatedContinuity:
    job: GenerationJob
    output: GenerationOutput
    report: ContinuityReportCandidate


@dataclass
class NovelDecisionCandidates:
    continuity: ValidatedContinuity | None = None
    continuity_stage: StageState | None = None
    release: dict[str, object] | None = None
    chapter_job: GenerationJob | None = None
    chapter: NovelChapterDraftCandidate | None = None


def validate_novel_decision(
    db: Session,
    project: Project,
    stage: StageState,
    stage_key: str,
    *,
    action: str,
    risk_ack: bool,
    reason: str | None,
) -> NovelDecisionCandidates:
    if action != "accept":
        return NovelDecisionCandidates()
    if stage_key == "continuity":
        continuity = _validated_continuity(db, project.id, stage)
        _validate_continuity_risks(continuity, risk_ack, reason)
        return NovelDecisionCandidates(continuity=continuity)
    if stage_key == "manuscriptRelease":
        return _validate_manuscript_release(db, project, stage)
    if stage_key == "novelDraft":
        return _validate_novel_chapter(db, project, stage)
    return NovelDecisionCandidates()


def _validate_continuity_risks(
    continuity: ValidatedContinuity, risk_ack: bool, reason: str | None
) -> None:
    report = continuity.report
    high_open = unresolved_high_findings(report)
    if high_open:
        raise NovelDecisionError(
            422,
            {"code": "high_severity_findings_must_be_resolved", "finding_ids": high_open},
        )
    medium_open = unresolved_medium_findings(report)
    if medium_open and (not risk_ack or not reason or not reason.strip()):
        raise NovelDecisionError(
            422,
            {
                "code": "open_medium_findings_require_risk_acknowledgement",
                "finding_ids": medium_open,
            },
        )
    accepted_risk = [
        finding.finding_id for finding in report.findings if finding.status == "accepted_risk"
    ]
    if accepted_risk and (not risk_ack or not reason or not reason.strip()):
        raise NovelDecisionError(422, "accepted_risk_findings_require_reason_and_risk_ack")


def _validate_manuscript_release(
    db: Session, project: Project, stage: StageState
) -> NovelDecisionCandidates:
    if project.creation_mode != "original":
        raise NovelDecisionError(422, "manuscript_release_requires_original_project")
    if project.rights_status == "unconfirmed":
        raise NovelDecisionError(422, "original_work_rights_must_be_recorded")
    continuity_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "continuity",
        )
    )
    if not continuity_stage or continuity_stage.status != "accepted":
        raise NovelDecisionError(409, "accepted_continuity_report_required")
    continuity = _validated_continuity(db, project.id, continuity_stage)
    report = continuity.report
    if unresolved_high_findings(report):
        raise NovelDecisionError(422, "high_severity_findings_must_be_resolved")
    latest_chapters = _latest_chapters(db, project.id)
    scoped_chapters = [
        latest_chapters[ordinal]
        for ordinal in range(report.chapter_start, report.chapter_end + 1)
        if ordinal in latest_chapters
    ]
    if len(scoped_chapters) != report.chapter_end - report.chapter_start + 1:
        raise NovelDecisionError(409, "manuscript_release_scope_is_not_contiguous")
    if len(scoped_chapters) < 2:
        raise NovelDecisionError(422, "manuscript_release_requires_at_least_two_chapters")
    release = {
        "action": "accept",
        "continuity_job_id": continuity.job.id,
        "continuity_report_revision": continuity.output.revision,
        "chapter_start": report.chapter_start,
        "chapter_end": report.chapter_end,
        "continuity_risk_ack": (continuity_stage.decision or {}).get("risk_ack", False),
        "chapter_versions": [
            {
                "ordinal": chapter.ordinal,
                "chapter_id": chapter.id,
                "version": chapter.version,
                "content_hash": chapter.content_hash,
            }
            for chapter in scoped_chapters
        ],
    }
    return NovelDecisionCandidates(
        continuity=continuity,
        continuity_stage=continuity_stage,
        release=release,
    )


def _validate_novel_chapter(
    db: Session, project: Project, stage: StageState
) -> NovelDecisionCandidates:
    if project.creation_mode != "original":
        raise NovelDecisionError(422, "novel_draft_requires_original_project")
    job_id = (stage.decision or {}).get("candidate_job_id")
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project.id,
            GenerationJob.stage_key == "novelDraft",
            GenerationJob.status == "succeeded",
        )
    )
    output = (
        db.scalar(
            select(GenerationOutput).where(
                GenerationOutput.project_id == project.id,
                GenerationOutput.job_id == job_id,
            )
        )
        if job
        else None
    )
    expected_ordinal = (
        (job.input_snapshot.get("scope") or {}).get("chapter_ordinal") if job else None
    )
    if not output or not isinstance(expected_ordinal, int):
        raise NovelDecisionError(409, "novel_chapter_candidate_missing")
    try:
        chapter = parse_chapter_candidate(output.content, expected_ordinal)
    except NovelDraftCandidateError as error:
        raise NovelDecisionError(422, str(error)) from None
    return NovelDecisionCandidates(
        chapter_job=job,
        chapter=chapter,
    )


def _latest_chapters(db: Session, project_id: str) -> dict[int, Chapter]:
    chapters = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.ordinal, Chapter.version.desc())
    ).all()
    latest: dict[int, Chapter] = {}
    for chapter in chapters:
        latest.setdefault(chapter.ordinal, chapter)
    return latest


def _validated_continuity(db: Session, project_id: str, stage: StageState) -> ValidatedContinuity:
    job_id = (stage.decision or {}).get("candidate_job_id")
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project_id,
            GenerationJob.stage_key == "continuity",
            GenerationJob.status == "succeeded",
        )
    )
    output = (
        db.scalar(
            select(GenerationOutput).where(
                GenerationOutput.project_id == project_id,
                GenerationOutput.job_id == job_id,
            )
        )
        if job
        else None
    )
    if not job or not output:
        raise NovelDecisionError(409, "continuity_report_candidate_missing")
    scope = job.input_snapshot.get("scope") or {}
    chapter_start = scope.get("chapter_start")
    chapter_end = scope.get("chapter_end")
    if type(chapter_start) is not int or type(chapter_end) is not int:
        raise NovelDecisionError(409, "continuity_report_scope_missing")
    chapters = _latest_chapters(db, project_id)
    chapter_texts = {
        ordinal: chapters[ordinal].body
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in chapters
    }
    context_ordinal = scope.get("context_chapter")
    if type(context_ordinal) is int:
        if context_ordinal not in chapters:
            raise NovelDecisionError(409, "continuity_report_context_chapter_changed")
        chapter_texts[context_ordinal] = chapters[context_ordinal].body
    latest_ids = {
        chapters[ordinal].id
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in chapters
    }
    if type(context_ordinal) is int and context_ordinal in chapters:
        latest_ids.add(chapters[context_ordinal].id)
    if not latest_ids.issubset(set(job.input_snapshot.get("input_refs", []))):
        raise NovelDecisionError(409, "continuity_report_chapter_versions_changed")
    try:
        report = parse_continuity_report(
            output.content,
            chapter_start,
            chapter_end,
            chapter_texts,
            allow_review_decisions=True,
        )
    except ContinuityReportError as error:
        raise NovelDecisionError(422, str(error)) from None
    return ValidatedContinuity(job=job, output=output, report=report)
