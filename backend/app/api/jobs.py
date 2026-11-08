from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..domain.models import (
    GenerationJob,
    GenerationOutput,
    GenerationOutputVersion,
    ServiceProfile,
    StageState,
)
from ..services.openai_compatible import ProviderExecutionError, complete_chat
from .common import (
    audit,
    get_db,
    project_or_404,
)
from .provider_security import (
    resolve_provider_secret,
    validate_provider_target,
)
from .schemas import (
    GenerationOutputEdit,
    JobCreate,
)

router = APIRouter()


@router.post("/projects/{project_id}/jobs", status_code=202)
def create_job(project_id: str, data: JobCreate, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    existing = db.scalar(
        select(GenerationJob).where(
            GenerationJob.project_id == project_id,
            GenerationJob.idempotency_key == data.idempotency_key,
        )
    )
    if existing:
        return replay_generation_job(db, existing, data)
    profile = db.get(ServiceProfile, data.profile_id)
    if not profile or profile.project_id != project_id:
        raise HTTPException(404, "service_profile_not_found")
    if not profile.enabled:
        raise HTTPException(409, "service_profile_not_enabled_or_tested")
    if profile.modality != data.modality:
        raise HTTPException(422, "profile_modality_mismatch")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == data.stage_key
        )
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status != "running":
        raise HTTPException(409, f"stage_must_be_running_before_generation:{stage.status}")
    if not data.data_authorized:
        raise HTTPException(422, "model_data_processing_consent_required")
    supported = data.modality == "text" and profile.adapter_id == "openai-compatible-chat"
    if not supported:
        job = GenerationJob(
            project_id=project_id,
            modality=data.modality,
            stage_key=data.stage_key,
            status="blocked",
            idempotency_key=data.idempotency_key,
            input_snapshot={
                "prompt": data.prompt,
                "parameters": data.parameters,
                "input_refs": data.input_refs,
                "data_authorized": data.data_authorized,
            },
            provider_snapshot={
                "profile_id": profile.id,
                "profile_version": profile.version,
                "adapter_id": profile.adapter_id,
                "model_id": profile.model_id,
            },
            error={
                "code": "adapter_not_registered",
                "message": "该模态的生成 Adapter 尚未接入；未向外部服务发送数据。",
            },
        )
        db.add(job)
        stage.status = "failed"
        stage.version += 1
        audit(db, project_id, "job.blocked", job.id, job.error)
        audit(
            db,
            project_id,
            "stage.execution_failed",
            stage.id,
            {"stage_key": stage.stage_key, "reason": "adapter_not_registered"},
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.scalar(
                select(GenerationJob).where(
                    GenerationJob.project_id == project_id,
                    GenerationJob.idempotency_key == data.idempotency_key,
                )
            )
            if existing:
                return replay_generation_job(db, existing, data)
            raise HTTPException(409, "generation_job_conflict") from None
        return {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "provider_snapshot": job.provider_snapshot,
        }

    secret = resolve_provider_secret(profile.secret_ref)
    if profile.secret_ref and not secret:
        raise HTTPException(409, "provider_secret_reference_not_configured")
    completion_url = profile.endpoint.rstrip("/")
    parsed = urlsplit(completion_url)
    if not parsed.path.rstrip("/").endswith("/chat/completions"):
        if parsed.path.rstrip("/").endswith("/models"):
            completion_url = completion_url[: -len("/models")]
        elif not parsed.path.rstrip("/").endswith("/v1"):
            completion_url = f"{completion_url}/v1"
        completion_url = f"{completion_url}/chat/completions"
    target_ips = validate_provider_target(completion_url, profile.transport)
    job = GenerationJob(
        project_id=project_id,
        modality=data.modality,
        stage_key=data.stage_key,
        status="running",
        idempotency_key=data.idempotency_key,
        input_snapshot={
            "prompt": data.prompt,
            "parameters": data.parameters,
            "input_refs": data.input_refs,
            "data_authorized": data.data_authorized,
            "stage_version": stage.version,
        },
        provider_snapshot={
            "profile_id": profile.id,
            "profile_version": profile.version,
            "adapter_id": profile.adapter_id,
            "model_id": profile.model_id,
            "endpoint": profile.endpoint,
        },
        error={},
    )
    db.add(job)
    audit(
        db,
        project_id,
        "job.started",
        job.id,
        {"stage_key": data.stage_key, "modality": data.modality, "profile_id": profile.id},
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(GenerationJob).where(
                GenerationJob.project_id == project_id,
                GenerationJob.idempotency_key == data.idempotency_key,
            )
        )
        if existing:
            return replay_generation_job(db, existing, data)
        raise HTTPException(409, "generation_job_conflict") from None
    try:
        content, usage = complete_chat(
            endpoint=completion_url,
            target_ip=target_ips[0],
            model_id=profile.model_id,
            secret=secret,
            prompt=data.prompt,
            parameters=data.parameters,
        )
    except ProviderExecutionError as error:
        db.expire_all()
        stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == data.stage_key
            )
        )
        job.error = {"code": error.code, "provider_status": error.http_status}
        current_execution = bool(
            stage
            and stage.status == "running"
            and stage.version == job.input_snapshot["stage_version"]
        )
        job.status = "failed" if current_execution else "stale"
        if current_execution and stage:
            stage.status = "failed"
            stage.version += 1
        audit(
            db,
            project_id,
            "job.failed" if current_execution else "job.result_stale",
            job.id,
            job.error,
        )
        db.commit()
        return {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "provider_snapshot": job.provider_snapshot,
        }
    except HTTPException as error:
        db.expire_all()
        stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == data.stage_key
            )
        )
        job.error = {"code": str(error.detail)}
        current_execution = bool(
            stage
            and stage.status == "running"
            and stage.version == job.input_snapshot["stage_version"]
        )
        job.status = "failed" if current_execution else "stale"
        if current_execution and stage:
            stage.status = "failed"
            stage.version += 1
        audit(
            db,
            project_id,
            "job.failed" if current_execution else "job.result_stale",
            job.id,
            job.error,
        )
        db.commit()
        return {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "provider_snapshot": job.provider_snapshot,
        }
    db.expire_all()
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == data.stage_key
        )
    )
    output = GenerationOutput(
        project_id=project_id,
        job_id=job.id,
        content_type="text/markdown",
        content=content,
        metadata_json={"usage": usage},
    )
    db.add(output)
    if (
        not stage
        or stage.status != "running"
        or stage.version != job.input_snapshot["stage_version"]
    ):
        job.status = "stale"
        audit(
            db,
            project_id,
            "job.result_stale",
            job.id,
            {"stage_key": data.stage_key, "output_id": output.id},
        )
    else:
        job.status = "succeeded"
        stage.status = "needs_review"
        stage.version += 1
        stage.stale = False
        stage.decision = {"candidate_job_id": job.id}
        audit(db, project_id, "job.succeeded", job.id, {"output_id": output.id, "usage": usage})
        audit(
            db,
            project_id,
            "stage.candidate_created",
            stage.id,
            {"stage_key": stage.stage_key, "job_id": job.id, "output_id": output.id},
        )
    db.commit()
    return {
        "id": job.id,
        "status": job.status,
        "output": safe_generation_output(output),
        "provider_snapshot": job.provider_snapshot,
    }


@router.get("/projects/{project_id}/jobs")
def list_jobs(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(
        select(GenerationJob)
        .where(GenerationJob.project_id == project_id)
        .order_by(GenerationJob.created_at.desc())
        .limit(20)
    ).all()
    outputs = {
        item.job_id: item
        for item in db.scalars(
            select(GenerationOutput).where(
                GenerationOutput.project_id == project_id,
                GenerationOutput.job_id.in_([job.id for job in rows]),
            )
        ).all()
    }
    return [
        {
            "id": j.id,
            "modality": j.modality,
            "stage_key": j.stage_key,
            "status": j.status,
            "input_snapshot": j.input_snapshot,
            "provider_snapshot": j.provider_snapshot,
            "output": safe_generation_output(outputs[j.id]) if j.id in outputs else None,
            "error": j.error,
            "created_at": j.created_at,
        }
        for j in rows
    ]


@router.put("/projects/{project_id}/jobs/{job_id}/output")
def edit_generation_output(
    project_id: str, job_id: str, data: GenerationOutputEdit, db: Session = Depends(get_db)
):
    project_or_404(db, project_id)
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id, GenerationJob.project_id == project_id
        )
    )
    if not job:
        raise HTTPException(404, "generation_job_not_found")
    output = db.scalar(
        select(GenerationOutput).where(
            GenerationOutput.job_id == job_id, GenerationOutput.project_id == project_id
        )
    )
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == job.stage_key
        )
    )
    if not output or job.status != "succeeded" or not stage:
        raise HTTPException(409, "generation_output_not_editable")
    if output.revision != data.revision:
        raise HTTPException(409, "generation_output_revision_conflict")
    if stage.status != "needs_review" or (stage.decision or {}).get("candidate_job_id") != job_id:
        raise HTTPException(409, "generation_candidate_is_not_current")
    db.add(
        GenerationOutputVersion(
            output_id=output.id,
            revision=output.revision,
            content=output.content,
        )
    )
    output.content = data.content
    output.revision += 1
    stage.version += 1
    audit(
        db,
        project_id,
        "generation_output.edited",
        output.id,
        {
            "job_id": job.id,
            "stage_key": job.stage_key,
            "revision": output.revision,
        },
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "generation_output_revision_conflict") from None
    db.refresh(output)
    return safe_generation_output(output)


@router.get("/projects/{project_id}/jobs/{job_id}/output/versions")
def list_generation_output_versions(project_id: str, job_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id, GenerationJob.project_id == project_id
        )
    )
    if not job:
        raise HTTPException(404, "generation_job_not_found")
    output = db.scalar(
        select(GenerationOutput).where(
            GenerationOutput.job_id == job_id, GenerationOutput.project_id == project_id
        )
    )
    if not output:
        raise HTTPException(404, "generation_output_not_found")
    versions = db.scalars(
        select(GenerationOutputVersion)
        .where(GenerationOutputVersion.output_id == output.id)
        .order_by(GenerationOutputVersion.revision.desc())
    ).all()
    return [
        {"revision": item.revision, "content": item.content, "created_at": item.created_at}
        for item in versions
    ] + [{"revision": output.revision, "content": output.content, "created_at": output.updated_at}]


def safe_generation_output(item: GenerationOutput) -> dict:
    return {
        "id": item.id,
        "job_id": item.job_id,
        "content_type": item.content_type,
        "content": item.content,
        "metadata": item.metadata_json,
        "revision": item.revision,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def replay_generation_job(db: Session, job: GenerationJob, data: JobCreate) -> dict:
    if (
        job.stage_key != data.stage_key
        or job.modality != data.modality
        or job.input_snapshot.get("prompt") != data.prompt
        or job.input_snapshot.get("parameters", {}) != data.parameters
        or job.input_snapshot.get("input_refs", []) != data.input_refs
        or job.input_snapshot.get("data_authorized", False) != data.data_authorized
        or job.provider_snapshot.get("profile_id") != data.profile_id
    ):
        raise HTTPException(409, "idempotency_key_reused_with_different_request")
    output = db.scalar(select(GenerationOutput).where(GenerationOutput.job_id == job.id))
    return {
        "id": job.id,
        "status": job.status,
        "idempotent_replay": True,
        "output": safe_generation_output(output) if output else None,
        "error": job.error,
    }
