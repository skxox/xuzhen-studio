import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    Chapter,
    CharacterReference,
    StageState,
)
from .common import (
    audit,
    get_db,
    invalidate_downstream_stages,
    project_or_404,
    safe_character_reference,
)
from .schemas import (
    ChapterCreate,
    ChapterRestore,
    ChapterRevision,
    CharacterReferenceCreate,
)

router = APIRouter()


@router.post("/projects/{project_id}/chapters", status_code=201)
def add_chapter(project_id: str, data: ChapterCreate, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    content_hash = hashlib.sha256(data.body.encode("utf-8")).hexdigest()
    previous_versions = db.scalars(
        select(Chapter.version).where(
            Chapter.project_id == project_id, Chapter.ordinal == data.ordinal
        )
    ).all()
    chapter = Chapter(
        project_id=project_id,
        content_hash=content_hash,
        version=max(previous_versions, default=0) + 1,
        **data.model_dump(),
    )
    db.add(chapter)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "chapter_ordinal_version_exists")
    src = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "source"
        )
    )
    if src:
        src.status = "needs_review"
        src.version += 1
        invalidate_downstream_stages(db, project, "source")
    audit(
        db,
        project_id,
        "chapter.imported",
        chapter.id,
        {"ordinal": chapter.ordinal, "sha256": content_hash},
    )
    db.commit()
    return {
        "id": chapter.id,
        "project_id": project_id,
        "ordinal": chapter.ordinal,
        "title": chapter.title,
        "content_hash": content_hash,
        "char_count": len(chapter.body),
        "version": chapter.version,
    }


@router.post("/projects/{project_id}/chapters/upload", status_code=201)
async def upload_text(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    filename = file.filename or "upload.txt"
    if Path(filename).suffix.lower() not in {".txt", ".md"}:
        raise HTTPException(415, "mvp_accepts_txt_md_only")
    raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "upload_too_large")
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "file_must_be_utf8")
    parts = re.split(
        r"(?m)^\s*(?:第[零〇一二三四五六七八九十百千万\d]+[章节回集].*|#{1,3}\s+.+)\s*$", content
    )
    titles = re.findall(
        r"(?m)^\s*(第[零〇一二三四五六七八九十百千万\d]+[章节回集].*|#{1,3}\s+.+)\s*$", content
    )
    chunks = [
        (titles[i].strip(" #\t"), parts[i + 1].strip())
        for i in range(min(len(titles), len(parts) - 1))
        if parts[i + 1].strip()
    ]
    if not chunks and content.strip():
        chunks = [(Path(filename).stem, content.strip())]
    if not chunks:
        raise HTTPException(422, "no_chapter_content_found")
    base = max(
        db.scalars(select(Chapter.ordinal).where(Chapter.project_id == project_id)).all(), default=0
    )
    created = []
    for i, (title, body) in enumerate(chunks, start=1):
        chapter = Chapter(
            project_id=project_id,
            ordinal=base + i,
            title=title,
            body=body,
            content_hash=hashlib.sha256(body.encode()).hexdigest(),
            source_name=filename,
        )
        db.add(chapter)
        db.flush()
        created.append(
            {
                "id": chapter.id,
                "ordinal": chapter.ordinal,
                "title": chapter.title,
                "char_count": len(body),
                "content_hash": chapter.content_hash,
            }
        )
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "source"
        )
    )
    if stage:
        stage.status = "needs_review"
        stage.version += 1
        invalidate_downstream_stages(db, project, "source")
    audit(
        db,
        project_id,
        "source.uploaded",
        project_id,
        {"filename": filename, "chapters": len(created)},
    )
    db.commit()
    return {"filename": filename, "chapters": created, "review_required": True}


@router.get("/projects/{project_id}/chapters")
def list_chapters(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    items = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.ordinal, Chapter.version.desc())
    ).all()
    latest: dict[int, Chapter] = {}
    for item in items:
        latest.setdefault(item.ordinal, item)
    items = sorted(latest.values(), key=lambda item: item.ordinal)
    return [
        {
            "id": c.id,
            "ordinal": c.ordinal,
            "title": c.title,
            "body": c.body,
            "content_hash": c.content_hash,
            "version": c.version,
            "source_name": c.source_name,
        }
        for c in items
    ]


@router.put("/projects/{project_id}/chapters/{chapter_id}")
def revise_chapter(
    project_id: str, chapter_id: str, data: ChapterRevision, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    current = db.scalar(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == project_id)
    )
    if not current:
        raise HTTPException(404, "chapter_not_found")
    latest_version = max(
        db.scalars(
            select(Chapter.version).where(
                Chapter.project_id == project_id, Chapter.ordinal == current.ordinal
            )
        ).all(),
        default=0,
    )
    if current.version != latest_version:
        raise HTTPException(409, "chapter_revision_is_not_latest")
    content_hash = hashlib.sha256(data.body.encode("utf-8")).hexdigest()
    revision = Chapter(
        project_id=project_id,
        ordinal=current.ordinal,
        title=data.title,
        body=data.body,
        content_hash=content_hash,
        version=current.version + 1,
        source_name=current.source_name,
    )
    db.add(revision)
    db.flush()
    source = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "source"
        )
    )
    if source:
        source.status = "needs_review"
        source.version += 1
        source.stale = False
        source.decision = {}
        invalidate_downstream_stages(db, project, "source")
    audit(
        db,
        project_id,
        "chapter.revised",
        revision.id,
        {
            "ordinal": revision.ordinal,
            "previous_version": current.version,
            "version": revision.version,
            "sha256": content_hash,
        },
    )
    db.commit()
    return {
        "id": revision.id,
        "project_id": project_id,
        "ordinal": revision.ordinal,
        "title": revision.title,
        "content_hash": revision.content_hash,
        "char_count": len(revision.body),
        "version": revision.version,
    }


@router.get("/projects/{project_id}/chapters/{chapter_id}/versions")
def list_chapter_versions(project_id: str, chapter_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    chapter = db.scalar(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == project_id)
    )
    if not chapter:
        raise HTTPException(404, "chapter_not_found")
    versions = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id, Chapter.ordinal == chapter.ordinal)
        .order_by(Chapter.version.desc())
    ).all()
    return [
        {
            "id": item.id,
            "ordinal": item.ordinal,
            "title": item.title,
            "body": item.body,
            "content_hash": item.content_hash,
            "version": item.version,
            "created_at": item.created_at,
        }
        for item in versions
    ]


@router.post("/projects/{project_id}/chapters/{chapter_id}/restore")
def restore_chapter_version(
    project_id: str, chapter_id: str, data: ChapterRestore, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    current = db.scalar(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.project_id == project_id)
    )
    if not current:
        raise HTTPException(404, "chapter_not_found")
    versions = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id, Chapter.ordinal == current.ordinal)
        .order_by(Chapter.version.desc())
    ).all()
    latest = versions[0] if versions else None
    target = next((item for item in versions if item.version == data.version), None)
    if not target:
        raise HTTPException(404, "chapter_version_not_found")
    if not latest or current.version != latest.version:
        raise HTTPException(409, "chapter_revision_is_not_latest")
    revision = Chapter(
        project_id=project_id,
        ordinal=current.ordinal,
        title=target.title,
        body=target.body,
        content_hash=target.content_hash,
        version=latest.version + 1,
        source_name=target.source_name,
    )
    db.add(revision)
    db.flush()
    source = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == "source"
        )
    )
    if source:
        source.status = "needs_review"
        source.version += 1
        source.stale = False
        source.decision = {}
        invalidate_downstream_stages(db, project, "source")
    audit(
        db,
        project_id,
        "chapter.version_restored",
        revision.id,
        {
            "ordinal": revision.ordinal,
            "restored_from": target.version,
            "version": revision.version,
            "sha256": revision.content_hash,
        },
    )
    db.commit()
    return {
        "id": revision.id,
        "project_id": project_id,
        "ordinal": revision.ordinal,
        "title": revision.title,
        "content_hash": revision.content_hash,
        "char_count": len(revision.body),
        "version": revision.version,
    }


@router.get("/projects/{project_id}/character-references")
def list_character_references(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    items = db.scalars(
        select(CharacterReference)
        .where(CharacterReference.project_id == project_id)
        .order_by(CharacterReference.created_at.desc())
    ).all()
    return [safe_character_reference(item) for item in items]


@router.post("/projects/{project_id}/character-references", status_code=201)
def create_character_reference(
    project_id: str, data: CharacterReferenceCreate, db: Session = Depends(get_db)
):
    project_or_404(db, project_id)
    item = CharacterReference(project_id=project_id, **data.model_dump())
    db.add(item)
    db.flush()
    audit(
        db,
        project_id,
        "character_reference.draft_created",
        item.id,
        {
            "name": item.name,
            "version": item.version,
            "status": item.status,
            "reference_views": item.reference_views,
        },
    )
    db.commit()
    db.refresh(item)
    return safe_character_reference(item)
