import hashlib
import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    GenerationJob,
    GenerationOutput,
    ServiceProfile,
    StageState,
    VideoCandidate,
)
from ..services.openai_compatible import ProviderExecutionError
from ..services.openai_compatible_video import download_video, retrieve_video
from .common import audit, get_db, project_or_404
from .provider_security import resolve_provider_secret, validate_provider_target

router = APIRouter()


@router.post("/projects/{project_id}/jobs/{job_id}/refresh")
def refresh_video_job(project_id: str, job_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project_id,
            GenerationJob.stage_key == "video",
        )
    )
    if not job:
        raise HTTPException(404, "video_job_not_found")
    candidate = db.scalar(select(VideoCandidate).where(VideoCandidate.job_id == job.id))
    if not candidate:
        raise HTTPException(409, "video_candidate_not_registered")
    if job.status != "running" or candidate.status not in {"queued", "processing"}:
        return _video_job_result(job, candidate)

    stage = _current_video_stage(db, project_id)
    if not _is_current_execution(stage, job):
        return _mark_video_stale(db, project_id, job, candidate)

    profile = db.get(ServiceProfile, job.provider_snapshot.get("profile_id"))
    if (
        not profile
        or profile.project_id != project_id
        or profile.adapter_id != "openai-compatible-video"
        or profile.version != job.provider_snapshot.get("profile_version")
    ):
        raise HTTPException(409, "video_provider_profile_snapshot_unavailable")
    secret = resolve_provider_secret(profile.secret_ref)
    if profile.secret_ref and not secret:
        raise HTTPException(409, "provider_secret_reference_not_configured")
    provider_endpoint = profile.endpoint
    target_ips = validate_provider_target(provider_endpoint, profile.transport)
    provider_task_id = candidate.provider_task_id
    db.commit()

    try:
        task = retrieve_video(
            endpoint=provider_endpoint,
            target_ip=target_ips[0],
            secret=secret,
            task_id=provider_task_id,
        )
        db.expire_all()
        job, candidate, stage = _reload_video_execution(db, project_id, job_id)
        if not _is_current_execution(stage, job):
            return _mark_video_stale(db, project_id, job, candidate)

        candidate.progress = task.progress
        if task.status == "failed":
            if not _transition_video_stage(db, stage, job, "failed"):
                return _mark_video_stale(db, project_id, job, candidate)
            candidate.status = "failed"
            candidate.error = task.error or {"code": "provider_video_generation_failed"}
            job.status = "failed"
            job.error = candidate.error
            audit(db, project_id, "video.failed", candidate.id, candidate.error)
        elif task.status == "completed":
            video_bytes = download_video(
                endpoint=provider_endpoint,
                target_ip=target_ips[0],
                secret=secret,
                task_id=provider_task_id,
            )
            db.expire_all()
            job, candidate, stage = _reload_video_execution(db, project_id, job_id)
            if not _is_current_execution(stage, job):
                return _mark_video_stale(db, project_id, job, candidate)

            next_decision = {"candidate_job_id": job.id, "video_candidate_id": candidate.id}
            if not _transition_video_stage(db, stage, job, "needs_review", next_decision):
                return _mark_video_stale(db, project_id, job, candidate)
            relative_key = f"generated/{project_id}/{uuid4()}.mp4"
            path = settings.storage_dir / relative_key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(video_bytes)
            candidate.storage_key = relative_key
            candidate.content_type = "video/mp4"
            candidate.size_bytes = len(video_bytes)
            candidate.sha256 = hashlib.sha256(video_bytes).hexdigest()
            candidate.status = "needs_review"
            job.status = "succeeded"
            output = db.scalar(select(GenerationOutput).where(GenerationOutput.job_id == job.id))
            if output:
                output.content = json.dumps(
                    {
                        "video_candidate_id": candidate.id,
                        "provider_task_id": candidate.provider_task_id,
                        "status": "completed",
                        "progress": 100,
                        "media_url": (
                            f"/api/projects/{project_id}/video-candidates/{candidate.id}/file"
                        ),
                        "size_bytes": candidate.size_bytes,
                        "sha256": candidate.sha256,
                    }
                )
            audit(
                db,
                project_id,
                "video.candidate_ready",
                candidate.id,
                {
                    "job_id": job.id,
                    "sha256": candidate.sha256,
                    "size_bytes": candidate.size_bytes,
                },
            )
        db.commit()
    except ProviderExecutionError as error:
        db.rollback()
        raise HTTPException(error.http_status, error.code) from None
    return _video_job_result(job, candidate)


def _current_video_stage(db: Session, project_id: str) -> StageState | None:
    return db.scalar(
        select(StageState).where(
            StageState.project_id == project_id,
            StageState.stage_key == "video",
        )
    )


def _reload_video_execution(
    db: Session, project_id: str, job_id: str
) -> tuple[GenerationJob, VideoCandidate, StageState | None]:
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project_id,
            GenerationJob.stage_key == "video",
        )
    )
    candidate = db.scalar(select(VideoCandidate).where(VideoCandidate.job_id == job_id))
    stage = _current_video_stage(db, project_id)
    if not job:
        raise HTTPException(404, "video_job_not_found")
    if not candidate:
        raise HTTPException(409, "video_candidate_not_registered")
    return job, candidate, stage


def _is_current_execution(stage: StageState | None, job: GenerationJob) -> bool:
    return bool(
        stage
        and stage.status == "running"
        and stage.version == job.input_snapshot.get("stage_version")
    )


def _transition_video_stage(
    db: Session,
    stage: StageState | None,
    job: GenerationJob,
    next_status: str,
    decision: dict | None = None,
) -> bool:
    if not stage:
        return False
    values: dict = {"status": next_status, "version": StageState.version + 1}
    if decision is not None:
        values.update(decision=decision, stale=False)
    result = db.execute(
        update(StageState)
        .where(
            StageState.id == stage.id,
            StageState.status == "running",
            StageState.version == job.input_snapshot.get("stage_version"),
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


def _mark_video_stale(
    db: Session,
    project_id: str,
    job: GenerationJob,
    candidate: VideoCandidate,
) -> dict:
    job.status = "stale"
    candidate.status = "stale"
    audit(db, project_id, "video.result_stale", candidate.id, {"job_id": job.id})
    db.commit()
    return _video_job_result(job, candidate)


def _video_job_result(job: GenerationJob, candidate: VideoCandidate) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "error": job.error,
        "video_candidate": {
            "id": candidate.id,
            "status": candidate.status,
            "progress": candidate.progress,
            "error": candidate.error,
        },
    }
