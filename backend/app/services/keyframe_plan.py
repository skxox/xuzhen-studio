from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import Project, ShotPlanRelease, StageState


class KeyframePlanError(ValueError):
    """Raised when the accepted shot plan is missing or stale."""


def current_shot_plan_release(db: Session, project: Project) -> ShotPlanRelease:
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id, StageState.stage_key == "shotDesign"
        )
    )
    release_id = (
        (stage.decision or {}).get("shot_plan_release_id")
        if stage and stage.status == "accepted"
        else None
    )
    release = db.get(ShotPlanRelease, release_id) if release_id else None
    if not release:
        raise KeyframePlanError("当前没有已验收的分镜版本。")
    script_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id, StageState.stage_key == "script"
        )
    )
    script_release_id = (
        (script_stage.decision or {}).get("script_release_id")
        if script_stage and script_stage.status == "accepted"
        else None
    )
    if release.script_release_id != script_release_id:
        raise KeyframePlanError("分镜引用的剧本已失效，请重新验收分镜。")
    return release


def find_shot(
    release: ShotPlanRelease, episode_number: int, scene_number: int, shot_number: int
) -> dict:
    for episode in release.episodes:
        if episode.get("episode_number") != episode_number:
            continue
        for scene in episode.get("scenes", []):
            if scene.get("scene_number") != scene_number:
                continue
            for shot in scene.get("shots", []):
                if shot.get("shot_number") == shot_number:
                    return shot
    raise KeyframePlanError("镜头编号不属于当前已验收分镜版本。")


def required_shots(release: ShotPlanRelease) -> set[tuple[int, int, int]]:
    return {
        (episode["episode_number"], scene["scene_number"], shot["shot_number"])
        for episode in release.episodes
        for scene in episode["scenes"]
        for shot in scene["shots"]
    }
