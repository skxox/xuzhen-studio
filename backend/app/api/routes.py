import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    AuditEvent,
    CharacterReference,
    Chapter,
    CreativeBrief,
    GenerationJob,
    Project,
    ServiceProfile,
    StageState,
)
from ..infrastructure.database import SessionLocal
from .schemas import (
    CharacterReferenceCreate,
    ChapterCreate,
    CreativeBriefSave,
    GateDecision,
    JobCreate,
    ProjectCreate,
    ServiceProfileCreate,
)

VIDEO_STAGES = ("source", "outline", "characters", "art", "script", "shotDesign", "keyframes", "video", "post", "delivery")
NOVEL_STAGES = ("creativeBrief", "storyBible", "novelOutline", "literaryCharacters", "novelDraft", "continuity", "manuscriptRelease", "source", "outline", "characters", "art", "script", "shotDesign", "keyframes", "video", "post", "delivery")
DEPENDENCIES = {
    "source": (), "outline": ("source",), "characters": ("outline",), "art": ("outline",),
    "script": ("outline", "characters", "art"), "shotDesign": ("script", "characters", "art"),
    "keyframes": ("shotDesign",), "video": ("shotDesign", "keyframes"), "post": ("video",),
    "delivery": ("post",), "creativeBrief": (), "storyBible": ("creativeBrief",),
    "novelOutline": ("storyBible",), "literaryCharacters": ("storyBible",),
    "novelDraft": ("novelOutline", "literaryCharacters"), "continuity": ("novelDraft",),
    "manuscriptRelease": ("continuity",),
}
ALLOWED = {
    "not_started": {"ready", "blocked"}, "ready": {"running", "blocked"},
    "running": {"needs_review", "failed", "blocked"},
    "needs_review": {"accepted", "waived", "running", "blocked"},
    "accepted": {"running", "stale"}, "waived": {"running", "stale"},
    "blocked": {"ready", "running", "stale"}, "stale": {"ready", "running", "blocked"},
    "failed": {"ready", "running", "stale"},
}


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def audit(db: Session, project_id: str, event: str, entity: str, payload: dict):
    db.add(AuditEvent(project_id=project_id, event_type=event, entity_ref=entity, payload=payload))


def project_or_404(db: Session, project_id: str) -> Project:
    obj = db.get(Project, project_id)
    if not obj:
        raise HTTPException(404, "project_not_found")
    return obj


def stage_dependencies(project: Project, stage_key: str) -> tuple[str, ...]:
    if stage_key == "source" and project.creation_mode == "original":
        return ("manuscriptRelease",)
    return DEPENDENCIES.get(stage_key, ())


def safe_project(p: Project):
    return {"id": p.id, "name": p.name, "creation_mode": p.creation_mode, "status": p.status,
            "genre": p.genre, "target_episodes": p.target_episodes, "episode_seconds": p.episode_seconds,
            "aspect_ratio": p.aspect_ratio, "rights_status": p.rights_status,
            "created_at": p.created_at, "updated_at": p.updated_at}


def safe_character_reference(item: CharacterReference):
    return {"id": item.id, "project_id": item.project_id, "name": item.name,
            "immutable_features": item.immutable_features, "costume_rules": item.costume_rules,
            "reference_views": item.reference_views, "status": item.status,
            "version": item.version, "created_at": item.created_at, "updated_at": item.updated_at}


def safe_creative_brief(item: CreativeBrief):
    return {"id": item.id, "project_id": item.project_id, "premise": item.premise,
            "genre": item.genre, "target_readers": item.target_readers,
            "narrative_pov": item.narrative_pov, "planned_scope": item.planned_scope,
            "style_baseline": item.style_baseline, "constraints": item.constraints,
            "rights_confirmed": item.rights_confirmed, "revision": item.revision,
            "status": item.status, "created_at": item.created_at, "updated_at": item.updated_at}


@router.get("/health")
def health():
    return {"status": "ok", "service": "xuzhen-studio-api"}


@router.post("/projects", status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(**data.model_dump())
    db.add(p)
    db.flush()
    path = NOVEL_STAGES if p.creation_mode == "original" else VIDEO_STAGES
    first_stage = "creativeBrief" if p.creation_mode == "original" else "source"
    for key in path:
        db.add(StageState(project_id=p.id, stage_key=key, status="ready" if key == first_stage else "not_started"))
    audit(db, p.id, "project.created", p.id, {"creation_mode": p.creation_mode})
    db.commit()
    return safe_project(p)


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [safe_project(p) for p in db.scalars(select(Project).order_by(Project.updated_at.desc())).all()]


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    return safe_project(project_or_404(db, project_id))


@router.get("/projects/{project_id}/stages")
def get_stages(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stages = db.scalars(select(StageState).where(StageState.project_id == project_id).order_by(StageState.created_at)).all()
    return [{"id": s.id, "stage_key": s.stage_key, "status": s.status, "version": s.version,
             "stale": s.stale, "decision": s.decision} for s in stages]


@router.post("/projects/{project_id}/chapters", status_code=201)
def add_chapter(project_id: str, data: ChapterCreate, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    content_hash = hashlib.sha256(data.body.encode("utf-8")).hexdigest()
    chapter = Chapter(project_id=project_id, content_hash=content_hash, **data.model_dump())
    db.add(chapter)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "chapter_ordinal_version_exists")
    src = db.scalar(select(StageState).where(StageState.project_id == project_id, StageState.stage_key == "source"))
    if src:
        src.status = "needs_review"
        src.version += 1
    audit(db, project_id, "chapter.imported", chapter.id, {"ordinal": chapter.ordinal, "sha256": content_hash})
    db.commit()
    return {"id": chapter.id, "project_id": project_id, "ordinal": chapter.ordinal, "title": chapter.title,
            "content_hash": content_hash, "char_count": len(chapter.body), "version": chapter.version}


@router.post("/projects/{project_id}/chapters/upload", status_code=201)
async def upload_text(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project_or_404(db, project_id)
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
    parts = re.split(r"(?m)^\s*(?:第[零〇一二三四五六七八九十百千万\d]+[章节回集].*|#{1,3}\s+.+)\s*$", content)
    titles = re.findall(r"(?m)^\s*(第[零〇一二三四五六七八九十百千万\d]+[章节回集].*|#{1,3}\s+.+)\s*$", content)
    chunks = [(titles[i].strip(" #\t"), parts[i + 1].strip()) for i in range(min(len(titles), len(parts) - 1)) if parts[i + 1].strip()]
    if not chunks and content.strip():
        chunks = [(Path(filename).stem, content.strip())]
    if not chunks:
        raise HTTPException(422, "no_chapter_content_found")
    base = max(db.scalars(select(Chapter.ordinal).where(Chapter.project_id == project_id)).all(), default=0)
    created = []
    for i, (title, body) in enumerate(chunks, start=1):
        chapter = Chapter(project_id=project_id, ordinal=base + i, title=title, body=body,
                          content_hash=hashlib.sha256(body.encode()).hexdigest(), source_name=filename)
        db.add(chapter)
        db.flush()
        created.append({"id": chapter.id, "ordinal": chapter.ordinal, "title": chapter.title,
                        "char_count": len(body), "content_hash": chapter.content_hash})
    stage = db.scalar(select(StageState).where(StageState.project_id == project_id, StageState.stage_key == "source"))
    if stage:
        stage.status = "needs_review"
        stage.version += 1
    audit(db, project_id, "source.uploaded", project_id, {"filename": filename, "chapters": len(created)})
    db.commit()
    return {"filename": filename, "chapters": created, "review_required": True}


@router.get("/projects/{project_id}/chapters")
def list_chapters(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    items = db.scalars(select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.ordinal)).all()
    return [{"id": c.id, "ordinal": c.ordinal, "title": c.title, "body": c.body,
             "content_hash": c.content_hash, "version": c.version, "source_name": c.source_name} for c in items]


@router.get("/projects/{project_id}/character-references")
def list_character_references(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    items = db.scalars(select(CharacterReference).where(
        CharacterReference.project_id == project_id
    ).order_by(CharacterReference.created_at.desc())).all()
    return [safe_character_reference(item) for item in items]


@router.post("/projects/{project_id}/character-references", status_code=201)
def create_character_reference(project_id: str, data: CharacterReferenceCreate, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    item = CharacterReference(project_id=project_id, **data.model_dump())
    db.add(item)
    db.flush()
    audit(db, project_id, "character_reference.draft_created", item.id, {
        "name": item.name, "version": item.version, "status": item.status,
        "reference_views": item.reference_views,
    })
    db.commit()
    db.refresh(item)
    return safe_character_reference(item)


@router.get("/projects/{project_id}/creative-brief")
def get_creative_brief(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "original":
        raise HTTPException(409, "creative_brief_only_available_for_original_projects")
    item = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
    return safe_creative_brief(item) if item else None


@router.put("/projects/{project_id}/creative-brief")
def save_creative_brief(
    project_id: str, data: CreativeBriefSave, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    if project.creation_mode != "original":
        raise HTTPException(409, "creative_brief_only_available_for_original_projects")
    stage = db.scalar(select(StageState).where(
        StageState.project_id == project_id, StageState.stage_key == "creativeBrief"
    ))
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
    audit(db, project_id, "creative_brief.saved", item.id, {
        "revision": item.revision, "rights_confirmed": item.rights_confirmed,
        "status": item.status,
    })
    db.commit()
    db.refresh(item)
    return safe_creative_brief(item)


@router.post("/projects/{project_id}/stages/{stage_key}/decision")
def decide_stage(project_id: str, stage_key: str, data: GateDecision, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(select(StageState).where(StageState.project_id == project_id, StageState.stage_key == stage_key))
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status != "needs_review":
        raise HTTPException(409, "stage_must_be_in_needs_review_before_decision")
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
        dep_states = {s.stage_key: s.status for s in db.scalars(select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key.in_(deps)
        )).all()}
        missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
        if missing:
            raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
    project = db.get(Project, project_id)
    if stage_key == "source" and data.action == "accept" and project.creation_mode == "adaptation":
        if not db.scalar(select(Chapter.id).where(Chapter.project_id == project_id)):
            raise HTTPException(422, "source_requires_at_least_one_chapter")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "source_rights_must_be_recorded")
    if stage_key == "manuscriptRelease" and data.action == "accept":
        chapter_count = len(db.scalars(select(Chapter.id).where(Chapter.project_id == project_id)).all())
        if chapter_count < 2:
            raise HTTPException(422, "manuscript_release_requires_at_least_two_chapters")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "original_work_rights_must_be_recorded")
    stage.status = target
    stage.version += 1
    stage.stale = False
    stage.decision = {"action": data.action, "reason": data.reason, "risk_ack": data.risk_ack}
    if stage_key == "creativeBrief":
        brief = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if data.action == "accept" else "draft"
    audit(db, project_id, "stage.decision", stage.id, stage.decision)
    db.commit()
    return {"id": stage.id, "stage_key": stage_key, "status": stage.status, "version": stage.version, "decision": stage.decision}


@router.post("/projects/{project_id}/stages/{stage_key}/start")
def start_stage(project_id: str, stage_key: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(select(StageState).where(StageState.project_id == project_id, StageState.stage_key == stage_key))
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status not in {"ready", "accepted", "waived", "stale", "failed"}:
        raise HTTPException(409, f"stage_cannot_start_from:{stage.status}")
    deps = stage_dependencies(project_or_404(db, project_id), stage_key)
    dep_states = {s.stage_key: s.status for s in db.scalars(select(StageState).where(
        StageState.project_id == project_id, StageState.stage_key.in_(deps)
    )).all()}
    missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
    if missing:
        raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
    stage.status = "running"
    stage.version += 1
    stage.stale = False
    audit(db, project_id, "stage.started", stage.id, {"stage_key": stage_key, "version": stage.version})
    db.commit()
    return {"id": stage.id, "stage_key": stage_key, "status": stage.status, "version": stage.version}


@router.post("/projects/{project_id}/stages/{stage_key}/submit-review")
def submit_stage_review(project_id: str, stage_key: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(select(StageState).where(StageState.project_id == project_id, StageState.stage_key == stage_key))
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
    stage.status = "needs_review"
    audit(db, project_id, "stage.submitted_for_review", stage.id, {"stage_key": stage_key, "version": stage.version})
    db.commit()
    return {"id": stage.id, "stage_key": stage_key, "status": stage.status, "version": stage.version}


@router.post("/projects/{project_id}/service-profiles", status_code=201)
def create_profile(project_id: str, data: ServiceProfileCreate, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    endpoint = str(data.endpoint)
    if not endpoint.startswith("https://") and not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", endpoint):
        raise HTTPException(422, "endpoint_requires_https_or_loopback_http")
    p = ServiceProfile(project_id=project_id, **data.model_dump(mode="json"))
    db.add(p)
    db.flush()
    audit(db, project_id, "service_profile.created", p.id, {"modality": p.modality, "adapter_id": p.adapter_id})
    db.commit()
    return {"id": p.id, "modality": p.modality, "name": p.name, "adapter_id": p.adapter_id,
            "transport": p.transport, "endpoint": p.endpoint, "model_id": p.model_id,
            "secret_ref": p.secret_ref, "enabled": p.enabled, "version": p.version}


@router.get("/projects/{project_id}/service-profiles")
def list_profiles(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(select(ServiceProfile).where(ServiceProfile.project_id == project_id)).all()
    return [{"id": p.id, "modality": p.modality, "name": p.name, "adapter_id": p.adapter_id,
             "transport": p.transport, "endpoint": p.endpoint, "model_id": p.model_id,
             "secret_ref": p.secret_ref, "capabilities": p.capabilities, "enabled": p.enabled,
             "version": p.version} for p in rows]


@router.post("/projects/{project_id}/jobs", status_code=202)
def create_job(project_id: str, data: JobCreate, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    existing = db.scalar(select(GenerationJob).where(GenerationJob.project_id == project_id,
                                                      GenerationJob.idempotency_key == data.idempotency_key))
    if existing:
        return {"id": existing.id, "status": existing.status, "idempotent_replay": True}
    profile = db.get(ServiceProfile, data.profile_id)
    if not profile or profile.project_id != project_id:
        raise HTTPException(404, "service_profile_not_found")
    if not profile.enabled:
        raise HTTPException(409, "service_profile_not_enabled_or_tested")
    if profile.modality != data.modality:
        raise HTTPException(422, "profile_modality_mismatch")
    # No provider adapter is registered yet; fail closed rather than simulate generation.
    job = GenerationJob(project_id=project_id, modality=data.modality, stage_key=data.stage_key,
                        status="blocked", idempotency_key=data.idempotency_key,
                        input_snapshot={"prompt": data.prompt, "parameters": data.parameters, "input_refs": data.input_refs},
                        provider_snapshot={"profile_id": profile.id, "profile_version": profile.version,
                                           "adapter_id": profile.adapter_id, "model_id": profile.model_id},
                        error={"code": "adapter_not_registered", "message": "该 Provider Adapter 尚未接入；未向外部服务发送数据。"})
    db.add(job)
    audit(db, project_id, "job.blocked", job.id, job.error)
    db.commit()
    return {"id": job.id, "status": job.status, "error": job.error,
            "provider_snapshot": job.provider_snapshot}


@router.get("/projects/{project_id}/jobs")
def list_jobs(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(select(GenerationJob).where(GenerationJob.project_id == project_id).order_by(GenerationJob.created_at.desc())).all()
    return [{"id": j.id, "modality": j.modality, "stage_key": j.stage_key, "status": j.status,
             "provider_snapshot": j.provider_snapshot, "error": j.error, "created_at": j.created_at} for j in rows]
