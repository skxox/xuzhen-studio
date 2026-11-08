from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    Project,
    StageState,
)
from .common import (
    COMMERCIAL_STAGES,
    NOVEL_STAGES,
    STAGE_METADATA,
    VIDEO_STAGES,
    audit,
    get_db,
    invalidate_downstream_stages,
    project_or_404,
    safe_project,
    stage_dependencies,
)
from .schemas import (
    ProjectCreate,
    ProjectRightsUpdate,
)

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "service": "xuzhen-studio-api"}


@router.post("/projects", status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(**data.model_dump())
    db.add(p)
    db.flush()
    path = (
        NOVEL_STAGES
        if p.creation_mode == "original"
        else COMMERCIAL_STAGES
        if p.creation_mode == "commercial"
        else VIDEO_STAGES
    )
    first_stage = (
        "creativeBrief"
        if p.creation_mode == "original"
        else "commercialBrief"
        if p.creation_mode == "commercial"
        else "source"
    )
    for key in path:
        db.add(
            StageState(
                project_id=p.id,
                stage_key=key,
                status="ready" if key == first_stage else "not_started",
            )
        )
    audit(db, p.id, "project.created", p.id, {"creation_mode": p.creation_mode})
    db.commit()
    return safe_project(p)


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [
        safe_project(p)
        for p in db.scalars(select(Project).order_by(Project.updated_at.desc())).all()
    ]


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    return safe_project(project_or_404(db, project_id))


@router.patch("/projects/{project_id}/rights")
def update_project_rights(
    project_id: str, data: ProjectRightsUpdate, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    if project.creation_mode == "commercial":
        raise HTTPException(409, "commercial_project_has_no_source_rights")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "source"
        )
    )
    if stage and stage.status == "needs_review":
        raise HTTPException(409, "source_locked_during_review")
    release = None
    if project.creation_mode == "original":
        release = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id,
                StageState.stage_key == "manuscriptRelease",
            )
        )
        if release and release.status == "needs_review":
            raise HTTPException(409, "manuscript_release_locked_during_review")
    previous = project.rights_status
    project.rights_status = data.rights_status
    if (
        project.creation_mode == "adaptation"
        and stage
        and previous != project.rights_status
        and stage.status in {"accepted", "waived", "stale", "blocked"}
    ):
        stage.status = "needs_review"
        stage.version += 1
        stage.stale = False
        stage.decision = {}
        invalidate_downstream_stages(db, project, "source")
    if project.creation_mode == "original" and previous != project.rights_status:
        if release and release.status in {"accepted", "waived", "stale", "blocked"}:
            previous_status = release.status
            release.status = "stale"
            release.stale = True
            release.version += 1
            release.decision = {}
            audit(
                db,
                project_id,
                "stage.invalidated",
                release.id,
                {
                    "stage_key": "manuscriptRelease",
                    "reason": "project_rights_changed",
                    "previous_status": previous_status,
                    "version": release.version,
                },
            )
            invalidate_downstream_stages(db, project, "manuscriptRelease")
    audit(
        db,
        project_id,
        "project.rights_updated",
        project_id,
        {
            "previous": previous,
            "current": project.rights_status,
        },
    )
    db.commit()
    return safe_project(project)


@router.get("/projects/{project_id}/stages")
def get_stages(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    stages = db.scalars(
        select(StageState)
        .where(StageState.project_id == project_id)
        .order_by(StageState.created_at)
    ).all()
    return [
        {
            "id": stage.id,
            "stage_key": stage.stage_key,
            "label": STAGE_METADATA.get(stage.stage_key, (stage.stage_key, "生产阶段", "阶段产物"))[
                0
            ],
            "responsibility": STAGE_METADATA.get(
                stage.stage_key, (stage.stage_key, "生产阶段", "阶段产物")
            )[1],
            "expected_output": STAGE_METADATA.get(
                stage.stage_key, (stage.stage_key, "生产阶段", "阶段产物")
            )[2],
            "depends_on": list(stage_dependencies(project, stage.stage_key)),
            "status": stage.status,
            "version": stage.version,
            "stale": stage.stale,
            "decision": stage.decision,
        }
        for stage in stages
    ]
