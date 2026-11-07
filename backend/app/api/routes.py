import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    AuditEvent,
    CharacterReference,
    Chapter,
    CommercialBrief,
    CommercialMaterial,
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
    CommercialBriefSave,
    CreativeBriefSave,
    GateDecision,
    JobCreate,
    ProjectCreate,
    ProjectRightsUpdate,
    ServiceProfileCreate,
)

VIDEO_STAGES = ("source", "outline", "characters", "art", "script", "shotDesign", "keyframes", "video", "post", "delivery")
NOVEL_STAGES = ("creativeBrief", "storyBible", "novelOutline", "literaryCharacters", "novelDraft", "continuity", "manuscriptRelease", "source", "outline", "characters", "art", "script", "shotDesign", "keyframes", "video", "post", "delivery")
COMMERCIAL_STAGES = ("commercialBrief", "outline", "characters", "art", "script", "shotDesign", "keyframes", "video", "post", "delivery")
DEPENDENCIES = {
    "source": (), "outline": ("source",), "characters": ("outline",), "art": ("outline",),
    "script": ("outline", "characters", "art"), "shotDesign": ("script", "characters", "art"),
    "keyframes": ("shotDesign",), "video": ("shotDesign", "keyframes"), "post": ("video",),
    "delivery": ("post",), "creativeBrief": (), "commercialBrief": (), "storyBible": ("creativeBrief",),
    "novelOutline": ("storyBible",), "literaryCharacters": ("storyBible",),
    "novelDraft": ("novelOutline", "literaryCharacters"), "continuity": ("novelDraft",),
    "manuscriptRelease": ("continuity",),
}
STAGE_METADATA = {
    "commercialBrief": ("商品与素材简报", "产品策划", "产品事实、受众、卖点、宣传边界与投放目标"),
    "creativeBrief": ("创意简报", "创作规划", "故事 premise、题材与创作边界"),
    "storyBible": ("故事圣经", "故事设计", "世界规则、人物弧与冲突引擎"),
    "novelOutline": ("长篇大纲", "长篇规划", "分卷与章节卡"),
    "literaryCharacters": ("文学角色圣经", "角色分析", "身份、动机、关系与人物弧"),
    "novelDraft": ("分批正文", "章节写作", "带版本的章节候选"),
    "continuity": ("连续性审校", "连续性审校", "范围内 findings 与修订建议"),
    "manuscriptRelease": ("原创稿锁版", "作者验收", "锁定的小说来源版本"),
    "source": ("原文与创意来源", "来源分析", "章节结构、出处与权利快照"),
    "outline": ("视频改编大纲", "改编规划", "分集卡与节拍映射"),
    "characters": ("视频角色约束", "角色设计", "表演边界与视觉角色卡"),
    "art": ("美术设定", "美术指导", "风格、场景与道具设定"),
    "script": ("分集剧本", "剧本编写", "场次、动作与对白"),
    "shotDesign": ("逐镜分镜", "分镜规划", "镜头、提示词与连续性 findings"),
    "keyframes": ("关键帧生成", "图像生成", "可审阅的镜头关键帧"),
    "video": ("逐镜视频生成", "视频生成", "逐镜视频候选"),
    "post": ("声音与成片", "后期合成", "配音、字幕与合成版本"),
    "delivery": ("审片与交付", "交付检查", "审片记录与交付 manifest"),
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


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        self.sock = socket.create_connection((self.target_ip, self.port), self.timeout, self.source_address)


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        sock = socket.create_connection((self.target_ip, self.port), self.timeout, self.source_address)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def resolve_provider_secret(secret_ref: str | None) -> str | None:
    if not secret_ref:
        return None
    env_key = f"XZ_PROVIDER_SECRET_{re.sub(r'[^A-Z0-9_]', '_', secret_ref.upper())}"
    value = os.environ.get(env_key)
    if value:
        return value
    return next((secret for key, secret in settings.provider_secrets.items() if key.casefold() == secret_ref.casefold()), None)


def validate_provider_target(endpoint: str, transport: str) -> list[str]:
    parsed = urlsplit(endpoint)
    hostname = parsed.hostname
    if not hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(422, "provider_endpoint_invalid")
    if parsed.scheme not in {"https", "http"}:
        raise HTTPException(422, "provider_endpoint_scheme_invalid")
    local_transport = transport in {"self_hosted_api", "local_runtime"}
    if parsed.scheme == "http" and not (local_transport and hostname in {"localhost", "127.0.0.1"}):
        raise HTTPException(422, "provider_endpoint_requires_https_or_loopback")
    try:
        try:
            addresses = {ipaddress.ip_address(hostname)}
        except ValueError:
            addresses = {
                ipaddress.ip_address(item[4][0].split("%", 1)[0])
                for item in socket.getaddrinfo(
                    hostname,
                    parsed.port or (443 if parsed.scheme == "https" else 80),
                    type=socket.SOCK_STREAM,
                )
            }
    except (OSError, ValueError):
        raise HTTPException(422, "provider_endpoint_dns_resolution_failed")
    if any(address.is_loopback for address in addresses) and not local_transport:
        raise HTTPException(422, "loopback_provider_requires_local_transport")
    allow_private = settings.allow_private_provider_endpoints and local_transport
    disallowed = any(
        not address.is_global and not (address.is_loopback and local_transport) and not allow_private
        for address in addresses
    )
    if not addresses or disallowed:
        raise HTTPException(422, "private_provider_endpoint_blocked")
    return [str(address) for address in addresses]


def persist_connection_test(db: Session, project_id: str, profile: ServiceProfile, result: dict) -> None:
    capabilities = dict(profile.capabilities or {})
    capabilities["connection_test"] = result
    profile.capabilities = capabilities
    profile.enabled = result["status"] == "connected"
    profile.version += 1
    audit(db, project_id, "service_profile.connection_tested", profile.id, {
        "status": result["status"], "adapter_id": profile.adapter_id, "modality": profile.modality,
    })
    db.commit()


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
    if stage_key == "outline" and project.creation_mode == "commercial":
        return ("commercialBrief",)
    if stage_key == "source" and project.creation_mode == "original":
        return ("manuscriptRelease",)
    return DEPENDENCIES.get(stage_key, ())


def invalidate_downstream_stages(db: Session, project: Project, stage_key: str) -> None:
    stages = db.scalars(select(StageState).where(StageState.project_id == project.id)).all()
    affected = {stage_key}
    changed = True
    while changed:
        changed = False
        for stage in stages:
            if stage.stage_key not in affected and any(
                dependency in affected for dependency in stage_dependencies(project, stage.stage_key)
            ):
                affected.add(stage.stage_key)
                changed = True
    for stage in stages:
        if stage.stage_key in affected - {stage_key} and stage.status not in {"not_started", "stale"}:
            previous_status = stage.status
            stage.status = "stale"
            stage.stale = True
            stage.version += 1
            stage.decision = {}
            audit(db, project.id, "stage.invalidated", stage.id, {
                "stage_key": stage.stage_key,
                "upstream_stage": stage_key,
                "previous_status": previous_status,
                "version": stage.version,
            })


def refresh_ready_stages(db: Session, project: Project) -> None:
    states = db.scalars(select(StageState).where(StageState.project_id == project.id)).all()
    statuses = {stage.stage_key: stage.status for stage in states}
    for stage in states:
        if stage.status != "not_started":
            continue
        dependencies = stage_dependencies(project, stage.stage_key)
        if dependencies and all(statuses.get(key) in {"accepted", "waived"} for key in dependencies):
            stage.status = "ready"
            stage.stale = False


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


def safe_commercial_brief(item: CommercialBrief):
    return {
        "id": item.id, "project_id": item.project_id, "product_name": item.product_name,
        "category": item.category, "product_facts": item.product_facts,
        "target_audience": item.target_audience, "selling_points": item.selling_points,
        "approved_claims": item.approved_claims, "prohibited_claims": item.prohibited_claims,
        "call_to_action": item.call_to_action, "distribution_channel": item.distribution_channel,
        "target_seconds": item.target_seconds, "rights_confirmed": item.rights_confirmed,
        "revision": item.revision, "status": item.status,
        "created_at": item.created_at, "updated_at": item.updated_at,
    }


def safe_commercial_material(item: CommercialMaterial):
    return {
        "id": item.id, "project_id": item.project_id, "original_name": item.original_name,
        "media_kind": item.media_kind, "content_type": item.content_type,
        "size_bytes": item.size_bytes, "sha256": item.sha256,
        "rights_status": item.rights_status, "created_at": item.created_at,
        "file_url": f"/projects/{item.project_id}/commercial-materials/{item.id}/file",
    }


@router.get("/health")
def health():
    return {"status": "ok", "service": "xuzhen-studio-api"}


@router.post("/projects", status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(**data.model_dump())
    db.add(p)
    db.flush()
    path = NOVEL_STAGES if p.creation_mode == "original" else COMMERCIAL_STAGES if p.creation_mode == "commercial" else VIDEO_STAGES
    first_stage = "creativeBrief" if p.creation_mode == "original" else "commercialBrief" if p.creation_mode == "commercial" else "source"
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


@router.patch("/projects/{project_id}/rights")
def update_project_rights(project_id: str, data: ProjectRightsUpdate, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "adaptation":
        raise HTTPException(409, "project_rights_update_only_available_for_adaptation")
    stage = db.scalar(select(StageState).where(
        StageState.project_id == project_id, StageState.stage_key == "source"
    ))
    if stage and stage.status == "needs_review":
        raise HTTPException(409, "source_locked_during_review")
    previous = project.rights_status
    project.rights_status = data.rights_status
    if stage and previous != project.rights_status and stage.status in {"accepted", "waived", "stale", "blocked"}:
        stage.status = "needs_review"
        stage.version += 1
        stage.stale = False
        stage.decision = {}
        invalidate_downstream_stages(db, project, "source")
    audit(db, project_id, "project.rights_updated", project_id, {
        "previous": previous, "current": project.rights_status,
    })
    db.commit()
    return safe_project(project)


@router.get("/projects/{project_id}/stages")
def get_stages(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    stages = db.scalars(select(StageState).where(StageState.project_id == project_id).order_by(StageState.created_at)).all()
    return [{
        "id": stage.id,
        "stage_key": stage.stage_key,
        "label": STAGE_METADATA.get(stage.stage_key, (stage.stage_key, "生产阶段", "阶段产物"))[0],
        "responsibility": STAGE_METADATA.get(stage.stage_key, (stage.stage_key, "生产阶段", "阶段产物"))[1],
        "expected_output": STAGE_METADATA.get(stage.stage_key, (stage.stage_key, "生产阶段", "阶段产物"))[2],
        "depends_on": list(stage_dependencies(project, stage.stage_key)),
        "status": stage.status,
        "version": stage.version,
        "stale": stage.stale,
        "decision": stage.decision,
    } for stage in stages]


@router.post("/projects/{project_id}/chapters", status_code=201)
def add_chapter(project_id: str, data: ChapterCreate, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
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
        invalidate_downstream_stages(db, project, "source")
    audit(db, project_id, "chapter.imported", chapter.id, {"ordinal": chapter.ordinal, "sha256": content_hash})
    db.commit()
    return {"id": chapter.id, "project_id": project_id, "ordinal": chapter.ordinal, "title": chapter.title,
            "content_hash": content_hash, "char_count": len(chapter.body), "version": chapter.version}


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
        invalidate_downstream_stages(db, project, "source")
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
    invalidate_downstream_stages(db, project, "creativeBrief")
    audit(db, project_id, "creative_brief.saved", item.id, {
        "revision": item.revision, "rights_confirmed": item.rights_confirmed,
        "status": item.status,
    })
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
def save_commercial_brief(project_id: str, data: CommercialBriefSave, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_brief_only_available_for_commercial_projects")
    stage = db.scalar(select(StageState).where(
        StageState.project_id == project_id, StageState.stage_key == "commercialBrief"
    ))
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
    audit(db, project_id, "commercial_brief.saved", item.id, {
        "revision": item.revision, "rights_confirmed": item.rights_confirmed,
        "selling_point_count": len(item.selling_points),
    })
    db.commit()
    db.refresh(item)
    return safe_commercial_brief(item)


@router.get("/projects/{project_id}/commercial-materials")
def list_commercial_materials(project_id: str, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    if project.creation_mode != "commercial":
        raise HTTPException(409, "commercial_materials_only_available_for_commercial_projects")
    items = db.scalars(select(CommercialMaterial).where(
        CommercialMaterial.project_id == project_id
    ).order_by(CommercialMaterial.created_at)).all()
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
    stage = db.scalar(select(StageState).where(
        StageState.project_id == project_id, StageState.stage_key == "commercialBrief"
    ))
    if stage and stage.status == "needs_review":
        raise HTTPException(409, "commercial_materials_locked_during_review")

    name = Path((file.filename or "material").replace("\\", "/")).name
    if not name or len(name) > 300 or any(ord(character) < 32 or ord(character) == 127 for character in name):
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
        signature_matches = content[4:8] == signature if suffix == ".mp4" else content.startswith(signature)
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
        id=item_id, project_id=project_id, original_name=name[:300], storage_key=storage_key,
        media_kind=kind, content_type=content_type, size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(), rights_status=rights_status,
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
    audit(db, project_id, "commercial_material.uploaded", item.id, {
        "media_kind": kind, "size_bytes": len(content), "sha256": item.sha256,
        "rights_status": rights_status,
    })
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
    item = db.scalar(select(CommercialMaterial).where(
        CommercialMaterial.id == material_id, CommercialMaterial.project_id == project_id
    ))
    if not item:
        raise HTTPException(404, "commercial_material_not_found")
    path = (settings.storage_dir.resolve() / item.storage_key).resolve()
    if settings.storage_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "commercial_material_file_not_found")
    return FileResponse(path, media_type=item.content_type, filename=item.original_name)


@router.post("/projects/{project_id}/stages/{stage_key}/decision")
def decide_stage(project_id: str, stage_key: str, data: GateDecision, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    stage = db.scalar(select(StageState).where(StageState.project_id == project_id, StageState.stage_key == stage_key))
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status != "needs_review":
        raise HTTPException(409, "stage_must_be_in_needs_review_before_decision")
    if stage_key == "creativeBrief" and data.action == "waive":
        raise HTTPException(422, "creative_brief_cannot_be_waived")
    if stage_key == "commercialBrief" and data.action == "waive":
        raise HTTPException(422, "commercial_brief_cannot_be_waived")
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
    if stage_key == "commercialBrief":
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if data.action == "accept" else "draft"
    if data.action in {"accept", "waive"}:
        refresh_ready_stages(db, project)
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
    project = project_or_404(db, project_id)
    deps = stage_dependencies(project, stage_key)
    dep_states = {s.stage_key: s.status for s in db.scalars(select(StageState).where(
        StageState.project_id == project_id, StageState.stage_key.in_(deps)
    )).all()}
    missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
    if missing:
        raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
    stage.status = "running"
    stage.version += 1
    stage.stale = False
    invalidate_downstream_stages(db, project, stage_key)
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
    if stage_key == "commercialBrief":
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if not brief:
            raise HTTPException(422, "commercial_brief_must_be_saved_before_review")
        if not brief.rights_confirmed:
            raise HTTPException(422, "commercial_brief_rights_must_be_confirmed")
        if not db.scalar(select(CommercialMaterial.id).where(CommercialMaterial.project_id == project_id)):
            raise HTTPException(422, "commercial_brief_requires_at_least_one_material")
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
            "secret_ref": p.secret_ref, "secret_configured": resolve_provider_secret(p.secret_ref) is not None,
            "enabled": p.enabled, "version": p.version}


@router.get("/projects/{project_id}/service-profiles")
def list_profiles(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(select(ServiceProfile).where(ServiceProfile.project_id == project_id)).all()
    return [{"id": p.id, "modality": p.modality, "name": p.name, "adapter_id": p.adapter_id,
             "transport": p.transport, "endpoint": p.endpoint, "model_id": p.model_id,
             "secret_ref": p.secret_ref, "capabilities": p.capabilities, "enabled": p.enabled,
             "secret_configured": resolve_provider_secret(p.secret_ref) is not None,
             "connection_test": (p.capabilities or {}).get("connection_test"),
             "version": p.version} for p in rows]


@router.post("/projects/{project_id}/service-profiles/{profile_id}/test")
def test_service_profile(project_id: str, profile_id: str, request: Request, db: Session = Depends(get_db)):
    client_host = request.client.host if request.client else ""
    try:
        is_loopback_client = ipaddress.ip_address(client_host).is_loopback
    except ValueError:
        is_loopback_client = False
    if not is_loopback_client:
        raise HTTPException(403, "provider_connection_test_local_only_until_authentication_is_enabled")
    project_or_404(db, project_id)
    profile = db.get(ServiceProfile, profile_id)
    if not profile or profile.project_id != project_id:
        raise HTTPException(404, "service_profile_not_found")
    if profile.modality != "text" or profile.adapter_id != "openai-compatible-chat":
        raise HTTPException(409, "connection_test_not_supported_for_adapter")

    tested_at = datetime.now(timezone.utc).isoformat()
    try:
        secret = resolve_provider_secret(profile.secret_ref)
        if profile.secret_ref and not secret:
            raise HTTPException(409, "provider_secret_reference_not_configured")
        parsed = urlsplit(profile.endpoint)
        base = profile.endpoint.rstrip("/")
        model_url = base if parsed.path.rstrip("/").endswith("/models") else f"{base}/models" if parsed.path.rstrip("/").endswith("/v1") else f"{base}/v1/models"
        model_parsed = urlsplit(model_url)
        target_ips = validate_provider_target(model_url, profile.transport)
        request_path = model_parsed.path or "/"
        if model_parsed.query:
            request_path = f"{request_path}?{model_parsed.query}"
        port = model_parsed.port or (443 if model_parsed.scheme == "https" else 80)
        headers = {"Accept": "application/json", "User-Agent": "XuzhenStudio-ProviderCheck/1.0", "Host": model_parsed.netloc}
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        connection_class = PinnedHTTPSConnection if model_parsed.scheme == "https" else PinnedHTTPConnection
        connection_kwargs = {"timeout": 10}
        if model_parsed.scheme == "https":
            connection_kwargs["context"] = ssl.create_default_context()
        connection = connection_class(model_parsed.hostname, port, target_ips[0], **connection_kwargs)
        try:
            connection.request("GET", request_path, headers=headers)
            response = connection.getresponse()
            status_code = response.status
            raw = response.read(1_000_001)
        finally:
            connection.close()
        if len(raw) > 1_000_000:
            raise HTTPException(502, "provider_models_response_too_large")
        if status_code != 200:
            code = "provider_authentication_failed" if status_code in {401, 403} else "provider_rate_limited" if status_code == 429 else "provider_endpoint_rejected"
            raise HTTPException(502, code)
        payload = json.loads(raw)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise HTTPException(502, "provider_models_response_invalid")
        model_ids = {
            entry["id"] for entry in payload["data"]
            if isinstance(entry, dict) and isinstance(entry.get("id"), str)
        }
        if profile.model_id not in model_ids:
            raise HTTPException(422, "provider_model_not_found")
        result = {"status": "connected", "model_available": True, "checked_at": tested_at}
        persist_connection_test(db, project_id, profile, result)
        return {**result, "profile_id": profile.id, "execution_ready": False,
                "message": "服务端已验证连接与模型 ID；实际生成执行器尚未启用。"}
    except OSError as error:
        code = "provider_connection_timeout" if isinstance(error, TimeoutError) else "provider_connection_failed"
    except TimeoutError:
        code = "provider_connection_timeout"
    except (json.JSONDecodeError, UnicodeDecodeError):
        code = "provider_models_response_invalid"
    except HTTPException as error:
        code = str(error.detail)
        status_code = error.status_code
        result = {"status": "failed", "model_available": False, "checked_at": tested_at, "error_code": code}
        persist_connection_test(db, project_id, profile, result)
        raise
    status_code = 502
    result = {"status": "failed", "model_available": False, "checked_at": tested_at, "error_code": code}
    persist_connection_test(db, project_id, profile, result)
    raise HTTPException(status_code, code)


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
             "input_snapshot": j.input_snapshot, "provider_snapshot": j.provider_snapshot,
             "error": j.error, "created_at": j.created_at} for j in rows]
