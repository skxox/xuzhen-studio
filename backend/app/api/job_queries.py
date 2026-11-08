from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import GenerationJob, GenerationOutput, GenerationOutputVersion
from .common import get_db, project_or_404
from .job_serialization import safe_generation_output

router = APIRouter()


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
            "id": job.id,
            "modality": job.modality,
            "stage_key": job.stage_key,
            "status": job.status,
            "input_snapshot": job.input_snapshot,
            "provider_snapshot": job.provider_snapshot,
            "output": safe_generation_output(outputs[job.id]) if job.id in outputs else None,
            "error": job.error,
            "created_at": job.created_at,
        }
        for job in rows
    ]


@router.get("/projects/{project_id}/jobs/{job_id}")
def get_job(project_id: str, job_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project_id,
        )
    )
    if not job:
        raise HTTPException(404, "generation_job_not_found")
    output = db.scalar(
        select(GenerationOutput).where(
            GenerationOutput.project_id == project_id,
            GenerationOutput.job_id == job_id,
        )
    )
    return {
        "id": job.id,
        "modality": job.modality,
        "stage_key": job.stage_key,
        "status": job.status,
        "input_snapshot": job.input_snapshot,
        "provider_snapshot": job.provider_snapshot,
        "output": safe_generation_output(output) if output else None,
        "error": job.error,
        "created_at": job.created_at,
    }


@router.get("/projects/{project_id}/jobs/{job_id}/output/versions")
def list_generation_output_versions(project_id: str, job_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project_id,
        )
    )
    if not job:
        raise HTTPException(404, "generation_job_not_found")
    output = db.scalar(
        select(GenerationOutput).where(
            GenerationOutput.job_id == job_id,
            GenerationOutput.project_id == project_id,
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
