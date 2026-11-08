from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    AuditEvent,
    CharacterReference,
    CommercialBrief,
    CommercialMaterial,
    CreativeBrief,
    Project,
    StageState,
)
from ..infrastructure.database import SessionLocal

VIDEO_STAGES = (
    "source",
    "outline",
    "characters",
    "art",
    "script",
    "shotDesign",
    "keyframes",
    "video",
    "post",
    "delivery",
)
NOVEL_STAGES = (
    "creativeBrief",
    "storyBible",
    "novelOutline",
    "literaryCharacters",
    "novelDraft",
    "continuity",
    "manuscriptRelease",
    "source",
    "outline",
    "characters",
    "art",
    "script",
    "shotDesign",
    "keyframes",
    "video",
    "post",
    "delivery",
)
COMMERCIAL_STAGES = (
    "commercialBrief",
    "outline",
    "characters",
    "art",
    "script",
    "shotDesign",
    "keyframes",
    "video",
    "post",
    "delivery",
)
DEPENDENCIES = {
    "source": (),
    "outline": ("source",),
    "characters": ("outline",),
    "art": ("outline",),
    "script": ("outline", "characters", "art"),
    "shotDesign": ("script", "characters", "art"),
    "keyframes": ("shotDesign",),
    "video": ("shotDesign", "keyframes"),
    "post": ("video",),
    "delivery": ("post",),
    "creativeBrief": (),
    "commercialBrief": (),
    "storyBible": ("creativeBrief",),
    "novelOutline": ("storyBible",),
    "literaryCharacters": ("storyBible", "novelOutline"),
    "novelDraft": ("novelOutline", "literaryCharacters"),
    "continuity": ("novelDraft",),
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
    "not_started": {"ready", "blocked"},
    "ready": {"running", "blocked"},
    "running": {"needs_review", "failed", "blocked"},
    "needs_review": {"accepted", "waived", "running", "blocked"},
    "accepted": {"running", "stale"},
    "waived": {"running", "stale"},
    "blocked": {"ready", "running", "stale"},
    "stale": {"ready", "running", "blocked"},
    "failed": {"ready", "running", "stale"},
}


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
                dependency in affected
                for dependency in stage_dependencies(project, stage.stage_key)
            ):
                affected.add(stage.stage_key)
                changed = True
    for stage in stages:
        if stage.stage_key in affected - {stage_key} and stage.status not in {
            "not_started",
            "stale",
        }:
            previous_status = stage.status
            stage.status = "stale"
            stage.stale = True
            stage.version += 1
            stage.decision = {}
            audit(
                db,
                project.id,
                "stage.invalidated",
                stage.id,
                {
                    "stage_key": stage.stage_key,
                    "upstream_stage": stage_key,
                    "previous_status": previous_status,
                    "version": stage.version,
                },
            )


def refresh_ready_stages(db: Session, project: Project) -> None:
    states = db.scalars(select(StageState).where(StageState.project_id == project.id)).all()
    statuses = {stage.stage_key: stage.status for stage in states}
    for stage in states:
        if stage.status != "not_started":
            continue
        dependencies = stage_dependencies(project, stage.stage_key)
        if dependencies and all(
            statuses.get(key) in {"accepted", "waived"} for key in dependencies
        ):
            stage.status = "ready"
            stage.stale = False


def safe_project(p: Project):
    return {
        "id": p.id,
        "name": p.name,
        "creation_mode": p.creation_mode,
        "status": p.status,
        "genre": p.genre,
        "target_episodes": p.target_episodes,
        "episode_seconds": p.episode_seconds,
        "aspect_ratio": p.aspect_ratio,
        "rights_status": p.rights_status,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def safe_character_reference(item: CharacterReference):
    return {
        "id": item.id,
        "project_id": item.project_id,
        "name": item.name,
        "immutable_features": item.immutable_features,
        "costume_rules": item.costume_rules,
        "reference_views": item.reference_views,
        "status": item.status,
        "version": item.version,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def safe_creative_brief(item: CreativeBrief):
    return {
        "id": item.id,
        "project_id": item.project_id,
        "premise": item.premise,
        "genre": item.genre,
        "target_readers": item.target_readers,
        "narrative_pov": item.narrative_pov,
        "planned_scope": item.planned_scope,
        "style_baseline": item.style_baseline,
        "constraints": item.constraints,
        "rights_confirmed": item.rights_confirmed,
        "revision": item.revision,
        "status": item.status,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def safe_commercial_brief(item: CommercialBrief):
    return {
        "id": item.id,
        "project_id": item.project_id,
        "product_name": item.product_name,
        "category": item.category,
        "product_facts": item.product_facts,
        "target_audience": item.target_audience,
        "selling_points": item.selling_points,
        "approved_claims": item.approved_claims,
        "prohibited_claims": item.prohibited_claims,
        "call_to_action": item.call_to_action,
        "distribution_channel": item.distribution_channel,
        "target_seconds": item.target_seconds,
        "rights_confirmed": item.rights_confirmed,
        "revision": item.revision,
        "status": item.status,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def safe_commercial_material(item: CommercialMaterial):
    return {
        "id": item.id,
        "project_id": item.project_id,
        "original_name": item.original_name,
        "media_kind": item.media_kind,
        "content_type": item.content_type,
        "size_bytes": item.size_bytes,
        "sha256": item.sha256,
        "rights_status": item.rights_status,
        "created_at": item.created_at,
        "file_url": f"/projects/{item.project_id}/commercial-materials/{item.id}/file",
    }
