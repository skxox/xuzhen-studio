import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import Chapter, ManuscriptRelease, Project, StageState
from ..services.audit import audit
from ..services.novel_decisions import NovelDecisionCandidates


def materialize_novel_chapter(
    db: Session,
    project_id: str,
    stage: StageState,
    candidates: NovelDecisionCandidates,
) -> None:
    chapter_candidate = candidates.chapter
    candidate_job = candidates.chapter_job
    if chapter_candidate is None or candidate_job is None:
        return
    previous_versions = db.scalars(
        select(Chapter.version).where(
            Chapter.project_id == project_id,
            Chapter.ordinal == chapter_candidate.ordinal,
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


def materialize_novel_decision(
    db: Session,
    project: Project,
    project_id: str,
    stage: StageState,
    stage_key: str,
    *,
    action: str,
    reason: str | None,
    risk_ack: bool,
    candidates: NovelDecisionCandidates,
) -> bool:
    continuity = candidates.continuity
    release_decision = candidates.release
    continuity_stage = candidates.continuity_stage
    if stage_key == "continuity" and action == "accept" and continuity:
        report = continuity.report
        stage.decision = {
            "action": "accept",
            "candidate_job_id": continuity.job.id,
            "report_revision": continuity.output.revision,
            "chapter_start": report.chapter_start,
            "chapter_end": report.chapter_end,
            "risk_ack": risk_ack,
            "reason": reason,
        }
        audit(
            db,
            project_id,
            "continuity.report_accepted",
            stage.id,
            {
                "candidate_job_id": continuity.job.id,
                "chapter_start": report.chapter_start,
                "chapter_end": report.chapter_end,
                "finding_count": len(report.findings),
            },
        )
        return True
    if (
        stage_key == "manuscriptRelease"
        and action == "accept"
        and release_decision
        and continuity_stage
    ):
        previous_release = db.scalar(
            select(ManuscriptRelease)
            .where(ManuscriptRelease.project_id == project_id)
            .order_by(ManuscriptRelease.revision.desc())
            .limit(1)
        )
        release = ManuscriptRelease(
            project_id=project_id,
            revision=(previous_release.revision + 1) if previous_release else 1,
            chapter_start=release_decision["chapter_start"],
            chapter_end=release_decision["chapter_end"],
            chapter_versions=release_decision["chapter_versions"],
            continuity_job_id=release_decision["continuity_job_id"],
            continuity_revision=release_decision["continuity_report_revision"],
            rights_status=project.rights_status,
            risk_ack=release_decision["continuity_risk_ack"],
            decision_reason=(continuity_stage.decision or {}).get("reason"),
            previous_release_id=previous_release.id if previous_release else None,
        )
        db.add(release)
        db.flush()
        release_decision["release_id"] = release.id
        release_decision["revision"] = release.revision
        release_decision["previous_release_id"] = release.previous_release_id
        stage.decision = release_decision
        audit(db, project_id, "manuscript.release_locked", release.id, release_decision)
        return True
    return False
