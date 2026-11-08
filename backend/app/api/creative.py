import hashlib
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    CommercialBrief,
    CommercialMaterial,
    CreativeBrief,
    StageState,
)
from .common import (
    audit,
    get_db,
    invalidate_downstream_stages,
    project_or_404,
    safe_commercial_brief,
    safe_commercial_material,
    safe_creative_brief,
)
from .schemas import (
    CommercialBriefSave,
    CreativeBriefSave,
)

router = APIRouter()


@router.get("/projects/{project_id}/creative-brief")
def get_creative_brief(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "original":
        raise HTTPException(409, "creative_brief_only_available_for_original_projects")
    item = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
    return safe_creative_brief(item) if item else None


@router.put("/projects/{project_id}/creative-brief")
def save_creative_brief(project_id: str, data: CreativeBriefSave, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "original":
        raise HTTPException(409, "creative_brief_only_available_for_original_projects")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "creativeBrief"
        )
    )
    if not stage:
        raise HTTPException(404, "creative_brief_stage_not_found")
    if stage.status == "needs_review":
        raise HTTPException(409, "creative_brief_locked_during_review")
    item = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
    if item:
        for field, value in data.model_dump().items():
            setattr(item, field, value)
        item.revision += 1
    else:
        item = CreativeBrief(project_id=project_id, **data.model_dump())
        db.add(item)
        db.flush()
    item.status = "draft"
    stage.status = "running"
    stage.version += 1
    stage.stale = False
    stage.decision = {}
    invalidate_downstream_stages(db, project, "creativeBrief")
    audit(
        db,
        project_id,
        "creative_brief.saved",
        item.id,
        {
            "revision": item.revision,
            "rights_confirmed": item.rights_confirmed,
            "status": item.status,
        },
    )
    db.commit()
    db.refresh(item)
    return safe_creative_brief(item)


@router.get("/projects/{project_id}/commercial-brief")
def get_commercial_brief(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_brief_only_available_for_commercial_projects")
    item = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
    return safe_commercial_brief(item) if item else None


@router.put("/projects/{project_id}/commercial-brief")
def save_commercial_brief(
    project_id: str, data: CommercialBriefSave, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_brief_only_available_for_commercial_projects")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "commercialBrief"
        )
    )
    if not stage:
        raise HTTPException(404, "commercial_brief_stage_not_found")
    if stage.status == "needs_review":
        raise HTTPException(409, "commercial_brief_locked_during_review")
    item = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
    if item:
        for field, value in data.model_dump().items():
            setattr(item, field, value)
        item.revision += 1
    else:
        item = CommercialBrief(project_id=project_id, **data.model_dump())
        db.add(item)
        db.flush()
    item.status = "draft"
    stage.status = "running"
    stage.version += 1
    stage.stale = False
    stage.decision = {}
    invalidate_downstream_stages(db, project, "commercialBrief")
    audit(
        db,
        project_id,
        "commercial_brief.saved",
        item.id,
        {
            "revision": item.revision,
            "rights_confirmed": item.rights_confirmed,
            "selling_point_count": len(item.selling_points),
        },
    )
    db.commit()
    db.refresh(item)
    return safe_commercial_brief(item)


@router.get("/projects/{project_id}/commercial-materials")
def list_commercial_materials(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_materials_only_available_for_commercial_projects")
    items = db.scalars(
        select(CommercialMaterial)
        .where(CommercialMaterial.project_id == project_id)
        .order_by(CommercialMaterial.created_at)
    ).all()
    return [safe_commercial_material(item) for item in items]


@router.post("/projects/{project_id}/commercial-materials", status_code=201)
async def upload_commercial_material(
    project_id: str,
    file: UploadFile = File(...),
    rights_status: Literal["owned", "licensed", "public_domain", "restricted"] = Form(...),
    db: Session = Depends(get_db),
):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_materials_only_available_for_commercial_projects")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "commercialBrief"
        )
    )
    if stage and stage.status == "needs_review":
        raise HTTPException(409, "commercial_materials_locked_during_review")

    name = Path((file.filename or "material").replace("\\", "/")).name
    if (
        not name
        or len(name) > 300
        or any(ord(character) < 32 or ord(character) == 127 for character in name)
    ):
        raise HTTPException(422, "invalid_filename")
    suffix = Path(name).suffix.lower()
    if not suffix or len(suffix) > 8:
        raise HTTPException(415, "unsupported_material_type")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "upload_too_large")
    signatures: dict[str, tuple[str, str, bytes]] = {
        ".png": ("image", "image/png", b"\x89PNG\r\n\x1a\n"),
        ".jpg": ("image", "image/jpeg", b"\xff\xd8\xff"),
        ".jpeg": ("image", "image/jpeg", b"\xff\xd8\xff"),
        ".webp": ("image", "image/webp", b"RIFF"),
        ".mp4": ("video", "video/mp4", b"ftyp"),
        ".webm": ("video", "video/webm", b"\x1aE\xdf\xa3"),
        ".pdf": ("document", "application/pdf", b"%PDF-"),
    }
    text_types = {".txt": "text/plain", ".md": "text/markdown"}
    if suffix in signatures:
        kind, content_type, signature = signatures[suffix]
        signature_matches = (
            content[4:8] == signature if suffix == ".mp4" else content.startswith(signature)
        )
        if suffix == ".webp":
            signature_matches = content.startswith(signature) and content[8:12] == b"WEBP"
        if not signature_matches:
            raise HTTPException(415, "file_signature_does_not_match_extension")
    elif suffix in text_types:
        try:
            content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(422, "text_material_must_be_utf8")
        kind, content_type = "document", text_types[suffix]
    else:
        raise HTTPException(415, "unsupported_material_type")
    if not content:
        raise HTTPException(422, "empty_file")

    item_id = str(uuid4())
    storage_key = f"{project_id}/commercial-materials/{item_id}{suffix}"
    root = settings.storage_dir.resolve()
    destination = (root / storage_key).resolve()
    if root not in destination.parents:
        raise HTTPException(422, "invalid_storage_path")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    item = CommercialMaterial(
        id=item_id,
        project_id=project_id,
        original_name=name[:300],
        storage_key=storage_key,
        media_kind=kind,
        content_type=content_type,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        rights_status=rights_status,
    )
    db.add(item)
    if stage:
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if brief:
            brief.revision += 1
            brief.status = "draft"
        stage.status = "running"
        stage.version += 1
        stage.stale = False
        stage.decision = {}
        invalidate_downstream_stages(db, project, "commercialBrief")
    audit(
        db,
        project_id,
        "commercial_material.uploaded",
        item.id,
        {
            "media_kind": kind,
            "size_bytes": len(content),
            "sha256": item.sha256,
            "rights_status": rights_status,
        },
    )
    try:
        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    return safe_commercial_material(item)


@router.get("/projects/{project_id}/commercial-materials/{material_id}/file")
def get_commercial_material_file(project_id: str, material_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_materials_only_available_for_commercial_projects")
    item = db.scalar(
        select(CommercialMaterial).where(
            CommercialMaterial.id == material_id, CommercialMaterial.project_id == project_id
        )
    )
    if not item:
        raise HTTPException(404, "commercial_material_not_found")
    path = (settings.storage_dir.resolve() / item.storage_key).resolve()
    if settings.storage_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "commercial_material_file_not_found")
    return FileResponse(path, media_type=item.content_type, filename=item.original_name)
