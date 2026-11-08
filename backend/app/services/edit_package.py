import hashlib
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from ..domain.models import AudioCandidate, ScriptRelease, ShotPlanRelease, VideoCandidate

MAX_EDIT_PACKAGE_BYTES = 1_000_000_000


class EditPackageError(ValueError):
    """Raised when locked script and storyboard data cannot form an edit package."""


@dataclass(frozen=True)
class EditPackageResult:
    size_bytes: int
    sha256: str
    shot_count: int
    subtitle_count: int
    audio_count: int
    subtitle_srt: str
    source_snapshot: dict


def build_edit_package(
    *,
    project_id: str,
    plan: ShotPlanRelease,
    script: ScriptRelease,
    candidates: dict[tuple[int, int, int], VideoCandidate],
    audio_candidates: dict[tuple[int, int, int], AudioCandidate],
    storage_dir: Path,
    output_path: Path,
    subtitle_override: str | None = None,
) -> EditPackageResult:
    if script.id != plan.script_release_id or script.branch_id != plan.branch_id:
        raise EditPackageError("当前分镜与剧本锁版不匹配。")
    dialogues = _dialogue_index(script.episodes)
    entries: list[tuple[str, bytes | Path]] = []
    manifest_shots: list[dict] = []
    subtitles: list[tuple[int, int, str, str]] = []
    audio_manifest: list[dict] = []
    dialogue_offsets: dict[tuple[int, int, int], tuple[int, int]] = {}
    if set(audio_candidates) != set(dialogues):
        raise EditPackageError("当前剧本的逐句配音覆盖不完整。")
    for audio_key, audio in sorted(audio_candidates.items()):
        if audio.status != "accepted" or audio.script_release_id != script.id:
            raise EditPackageError("存在未验收或过期的对白配音。")
        audio_path = (storage_dir / audio.storage_key).resolve()
        if storage_dir.resolve() not in audio_path.parents or not audio_path.is_file():
            raise EditPackageError("已验收对白配音文件缺失。")
        episode_number, scene_number, dialogue_number = audio_key
        audio_name = (
            f"audio/ep{episode_number:02}-sc{scene_number:02}-dl{dialogue_number:02}"
            f"{audio_path.suffix}"
        )
        entries.append((audio_name, audio_path))
        audio_manifest.append(
            {
                "episode_number": episode_number,
                "scene_number": scene_number,
                "dialogue_number": dialogue_number,
                "asset": audio_name,
                "audio_candidate_id": audio.id,
                "voice_id": audio.voice_id,
                "sha256": audio.sha256,
            }
        )
    timeline_ms = 0
    for episode in plan.episodes:
        episode_number = _positive_int(episode.get("episode_number"), "集序")
        for scene in episode.get("scenes", []):
            scene_number = _positive_int(scene.get("scene_number"), "场次")
            for shot in scene.get("shots", []):
                shot_number = _positive_int(shot.get("shot_number"), "镜头序号")
                key = (episode_number, scene_number, shot_number)
                candidate = candidates.get(key)
                if not candidate or candidate.status != "accepted":
                    raise EditPackageError("存在未验收的视频镜头，不能生成剪辑包。")
                path = (storage_dir / candidate.storage_key).resolve()
                if storage_dir.resolve() not in path.parents or not path.is_file():
                    raise EditPackageError("已验收镜头的视频文件缺失。")
                with path.open("rb") as video_file:
                    signature = video_file.read(12)
                if len(signature) < 12 or signature[4:8] != b"ftyp":
                    raise EditPackageError("镜头视频文件不是有效 MP4。")
                filename = f"clips/ep{episode_number:02}-sc{scene_number:02}-sh{shot_number:02}.mp4"
                entries.append((filename, path))
                duration_ms = candidate.requested_seconds * 1000
                shot_start = timeline_ms
                dialogue_lines = []
                for dialogue_number in shot.get("dialogue_numbers", []):
                    line = dialogues.get((episode_number, scene_number, dialogue_number))
                    if not line:
                        raise EditPackageError("分镜对白编号无法对应到已验收剧本。")
                    dialogue_lines.append(line)
                slots = _subtitle_slots(dialogue_lines, duration_ms)
                if len(slots) != len(dialogue_lines):
                    raise EditPackageError("镜头时长不足以容纳关联对白，无法建立配音时间线。")
                for line, (start, end, speaker, text) in zip(dialogue_lines, slots, strict=True):
                    subtitles.append((shot_start + start, shot_start + end, speaker, text))
                    dialogue_key = (episode_number, scene_number, line["dialogue_number"])
                    dialogue_offsets.setdefault(dialogue_key, (shot_start + start, len(subtitles)))
                manifest_shots.append(
                    {
                        "order": len(manifest_shots) + 1,
                        "episode_number": episode_number,
                        "scene_number": scene_number,
                        "shot_number": shot_number,
                        "asset": filename,
                        "video_candidate_id": candidate.id,
                        "keyframe_candidate_id": candidate.keyframe_candidate_id,
                        "duration_seconds_requested": candidate.requested_seconds,
                        "planned_duration_seconds": shot.get("duration_seconds"),
                        "dialogue_numbers": shot.get("dialogue_numbers", []),
                        "transition": shot.get("transition", ""),
                        "sha256": candidate.sha256,
                    }
                )
                timeline_ms += duration_ms

    if set(dialogue_offsets) != set(audio_candidates):
        raise EditPackageError("存在未关联到镜头的对白，无法安排配音时间线。")
    for audio in audio_manifest:
        key = (audio["episode_number"], audio["scene_number"], audio["dialogue_number"])
        audio["start_ms"], audio["subtitle_index"] = dialogue_offsets[key]
    manifest = {
        "schema_version": "1.0",
        "project_id": project_id,
        "branch_id": plan.branch_id,
        "shot_plan_release_id": plan.id,
        "shot_plan_revision": plan.revision,
        "script_release_id": script.id,
        "script_revision": script.revision,
        "timing_basis": "requested_video_seconds; verify against media before final export",
        "audio": {
            "included": bool(audio_manifest),
            "mixing_included": False,
            "clips": audio_manifest,
        },
        "shots": manifest_shots,
    }
    total_size = sum(
        data.stat().st_size if isinstance(data, Path) else len(data) for _, data in entries
    )
    if total_size > MAX_EDIT_PACKAGE_BYTES:
        raise EditPackageError("剪辑包内容超出当前 1 GB 上限。")
    subtitle_text = subtitle_override if subtitle_override is not None else _format_srt(subtitles)
    subtitle_rows = _parse_srt(subtitle_text, max_milliseconds=timeline_ms)
    entries.extend(
        [
            ("subtitles/zh-CN.srt", subtitle_text.encode("utf-8-sig")),
            (
                "manifest.json",
                json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
            ),
            (
                "README.txt",
                (
                    "叙帧剪辑交接包\n"
                    "clips/ 按 manifest.json 的 order 排列。\n"
                    "subtitles/zh-CN.srt 按镜头请求时长估算时间码；\n"
                    "正式导出前请在剪辑软件中按素材实际时长校准。\n"
                    "audio/ 按对白编号保存已验收的独立配音片段，不含混音。\n"
                    "本包不包含转场渲染或最终母版。\n"
                ).encode(),
            ),
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, payload in entries:
            if isinstance(payload, Path):
                archive.write(payload, name)
            else:
                archive.writestr(name, payload)
    size_bytes = output_path.stat().st_size
    if size_bytes > MAX_EDIT_PACKAGE_BYTES:
        raise EditPackageError("生成后的剪辑包超过 1 GB 上限。")
    digest = hashlib.sha256()
    with output_path.open("rb") as package_file:
        for chunk in iter(lambda: package_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return EditPackageResult(
        size_bytes=size_bytes,
        sha256=digest.hexdigest(),
        shot_count=len(manifest_shots),
        subtitle_count=len(subtitle_rows),
        audio_count=len(audio_manifest),
        subtitle_srt=subtitle_text,
        source_snapshot={
            "shot_plan_release_id": plan.id,
            "shot_plan_revision": plan.revision,
            "script_release_id": script.id,
            "script_revision": script.revision,
            "video_candidate_ids": [shot["video_candidate_id"] for shot in manifest_shots],
            "audio_candidate_ids": [audio["audio_candidate_id"] for audio in audio_manifest],
            "subtitle_preview": [
                {
                    "start_ms": start,
                    "end_ms": end,
                    "text": f"{speaker}：{text}",
                }
                for start, end, text in subtitle_rows[:30]
            ],
        },
    )


def _dialogue_index(episodes: list[dict]) -> dict[tuple[int, int, int], dict]:
    result = {}
    for episode in episodes:
        episode_number = _positive_int(episode.get("episode_number"), "剧本集序")
        for scene in episode.get("scenes", []):
            scene_number = _positive_int(scene.get("scene_number"), "剧本场次")
            for dialogue in scene.get("dialogues", []):
                number = _positive_int(dialogue.get("dialogue_number"), "对白编号")
                speaker, text = dialogue.get("speaker"), dialogue.get("text")
                if not isinstance(speaker, str) or not isinstance(text, str) or not text.strip():
                    raise EditPackageError("已验收剧本对白缺少说话人或内容。")
                result[(episode_number, scene_number, number)] = {
                    "dialogue_number": number,
                    "speaker": speaker.strip(),
                    "text": text.strip(),
                    "seconds": _positive_int(dialogue.get("estimated_seconds"), "对白时长"),
                }
    return result


def _subtitle_slots(dialogues: list[dict], duration_ms: int) -> list[tuple[int, int, str, str]]:
    if not dialogues or duration_ms < 1:
        return []
    expected = sum(line["seconds"] for line in dialogues)
    scale = min(1.0, duration_ms / (expected * 1000))
    cursor = 0
    slots = []
    for line in dialogues:
        slot = max(500, round(line["seconds"] * 1000 * scale))
        end = min(duration_ms, cursor + slot)
        if end > cursor:
            slots.append((cursor, end, line["speaker"], line["text"]))
        cursor = end
    return slots


def _format_srt(subtitles: list[tuple[int, int, str, str]]) -> str:
    blocks = []
    for index, (start, end, speaker, text) in enumerate(subtitles, 1):
        blocks.append(f"{index}\n{_timestamp(start)} --> {_timestamp(end)}\n{speaker}：{text}\n")
    return "\n".join(blocks)


def _parse_srt(value: str, *, max_milliseconds: int | None = None) -> list[tuple[int, int, str]]:
    if len(value.encode("utf-8")) > 2_000_000:
        raise EditPackageError("字幕文件不能超过 2 MB。")
    normalized = value.lstrip("\ufeff").strip()
    if not normalized:
        return []
    blocks = re.split(r"\r?\n\s*\r?\n", normalized)
    rows = []
    previous_end = -1
    for expected_index, block in enumerate(blocks, 1):
        lines = block.splitlines()
        if len(lines) < 3 or lines[0].strip() != str(expected_index):
            raise EditPackageError("SRT 序号必须从 1 连续排列，且每条至少包含序号、时间码和字幕。")
        match = re.fullmatch(
            r"(\d{2,}:\d{2}:\d{2},\d{3})\s+-->\s+"
            r"(\d{2,}:\d{2}:\d{2},\d{3})",
            lines[1].strip(),
        )
        if not match:
            raise EditPackageError("SRT 时间码格式无效，应为 HH:MM:SS,mmm。")
        start, end = (_parse_timestamp(part) for part in match.groups())
        text = "\n".join(lines[2:]).strip()
        if not text or start < previous_end or end <= start:
            raise EditPackageError("SRT 字幕文本不能为空，时间码须递增且结束时间晚于开始时间。")
        if max_milliseconds is not None and end > max_milliseconds:
            raise EditPackageError("SRT 字幕不能超出当前视频时间线总时长。")
        rows.append((start, end, text))
        previous_end = end
    return rows


def _parse_timestamp(value: str) -> int:
    hours, minutes, rest = value.split(":")
    seconds, millis = rest.split(",")
    if int(minutes) > 59 or int(seconds) > 59:
        raise EditPackageError("SRT 时间码中的分钟或秒数超出范围。")
    return (((int(hours) * 60 + int(minutes)) * 60) + int(seconds)) * 1000 + int(millis)


def _timestamp(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{millis:03}"


def _positive_int(value: object, label: str) -> int:
    if type(value) is not int or value < 1:
        raise EditPackageError(f"{label}无效，无法生成剪辑包。")
    return value
