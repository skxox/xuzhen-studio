from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import Project, StageState

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

VIDEO_PRODUCTION_STAGES = {
    "outline",
    "characters",
    "art",
    "script",
    "voice",
    "shotDesign",
    "keyframes",
    "video",
    "post",
    "delivery",
}


class StageDecisionPolicyError(Exception):
    def __init__(self, status_code: int, detail: object):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


def validate_stage_mode(project: Project, stage_key: str) -> None:
    if reason := stage_mode_unavailable_reason(project, stage_key):
        raise StageDecisionPolicyError(
            409,
            {
                "code": "video_pipeline_mode_not_supported",
                "creation_mode": project.creation_mode,
                "stage_key": stage_key,
                "reason": reason,
            },
        )


def stage_mode_unavailable_reason(project: Project, stage_key: str) -> str | None:
    if project.creation_mode != "original" and stage_key in VIDEO_PRODUCTION_STAGES:
        return "当前版本暂不支持导入小说或商品项目的后续视频生产流程。"
    return None


def stage_dependencies(project: Project, stage_key: str) -> tuple[str, ...]:
    if stage_key == "outline" and project.creation_mode == "commercial":
        return ("commercialBrief",)
    if stage_key == "source" and project.creation_mode == "original":
        return ("manuscriptRelease",)
    return DEPENDENCIES.get(stage_key, ())


DEPENDENCIES = {
    "source": (),
    "outline": ("source",),
    "characters": ("outline",),
    "art": ("outline", "characters"),
    "script": ("outline", "characters", "art"),
    "voice": ("script",),
    "shotDesign": ("script", "characters", "art"),
    "keyframes": ("shotDesign",),
    "video": ("shotDesign", "keyframes"),
    "post": ("video", "voice"),
    "delivery": ("post",),
    "storyBible": ("creativeBrief",),
    "novelOutline": ("storyBible",),
    "literaryCharacters": ("storyBible", "novelOutline"),
    "novelDraft": ("novelOutline", "literaryCharacters"),
    "continuity": ("novelDraft",),
    "manuscriptRelease": ("continuity",),
    "creativeBrief": (),
    "commercialBrief": (),
}


def validate_stage_decision(
    db: Session,
    project: Project,
    stage: StageState,
    stage_key: str,
    *,
    action: str,
    reason: str | None,
    risk_ack: bool,
) -> str:
    validate_stage_mode(project, stage_key)
    if stage.status != "needs_review":
        raise StageDecisionPolicyError(409, "stage_must_be_in_needs_review_before_decision")
    if stage_key in {"creativeBrief", "commercialBrief"} and action == "waive":
        code = {
            "creativeBrief": "creative_brief_cannot_be_waived",
            "commercialBrief": "commercial_brief_cannot_be_waived",
        }[stage_key]
        raise StageDecisionPolicyError(422, code)
    if (
        stage_key
        in {
            "source",
            "outline",
            "shotDesign",
            "keyframes",
            "video",
            "voice",
            "post",
            "delivery",
        }
        and action == "waive"
    ):
        raise StageDecisionPolicyError(422, "media_production_gates_cannot_be_waived")
    if stage_key in {"continuity", "manuscriptRelease"} and action == "waive":
        raise StageDecisionPolicyError(422, "novel_quality_gates_cannot_be_waived")
    if action in {"waive", "reject"} and not reason:
        raise StageDecisionPolicyError(422, "reason_required")
    if action == "waive" and not risk_ack:
        raise StageDecisionPolicyError(422, "risk_ack_required")
    target = {"accept": "accepted", "waive": "waived", "reject": "blocked"}[action]
    if target not in ALLOWED.get(stage.status, set()):
        raise StageDecisionPolicyError(409, f"invalid_transition:{stage.status}->{target}")
    if action in {"accept", "waive"}:
        dependencies = stage_dependencies(project, stage_key)
        dependency_states = {
            item.stage_key: item.status
            for item in db.scalars(
                select(StageState).where(
                    StageState.project_id == project.id,
                    StageState.stage_key.in_(dependencies),
                )
            ).all()
        }
        missing = [
            key for key in dependencies if dependency_states.get(key) not in {"accepted", "waived"}
        ]
        if missing:
            raise StageDecisionPolicyError(
                409, {"code": "upstream_gate_blocked", "stages": missing}
            )
    return target
