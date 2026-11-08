import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

MAX_MASTER_BYTES = 2_000_000_000
MAX_PACKAGE_BYTES = 1_000_000_000


class MasterRenderError(ValueError):
    """Raised when an accepted edit package cannot be rendered as a master video."""


@dataclass(frozen=True)
class MasterRenderResult:
    size_bytes: int
    sha256: str
    duration_seconds: float
    width: int
    height: int


def ffmpeg_available(binary: str) -> bool:
    executable = shutil.which(binary)
    if not executable:
        return False
    try:
        result = subprocess.run(
            [executable, "-version"], capture_output=True, timeout=5, check=False
        )
        encoders = subprocess.run(
            [executable, "-hide_banner", "-encoders"],
            capture_output=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    available_encoders = (encoders.stdout + encoders.stderr).decode("utf-8", errors="ignore")
    return (
        result.returncode == 0
        and encoders.returncode == 0
        and all(name in available_encoders for name in ("libx264", "aac", "mov_text"))
    )


def render_master(
    *,
    package_path: Path,
    output_path: Path,
    aspect_ratio: str,
    ffmpeg_binary: str,
    expected_package_sha256: str,
) -> MasterRenderResult:
    if not ffmpeg_available(ffmpeg_binary):
        raise MasterRenderError("ffmpeg_unavailable")
    width, height = _dimensions(aspect_ratio)
    with tempfile.TemporaryDirectory(prefix="xuzhen-master-") as temp_name:
        work_dir = Path(temp_name)
        if _sha256(package_path) != expected_package_sha256:
            raise MasterRenderError("accepted_edit_package_hash_mismatch")
        manifest = _extract_package(package_path, work_dir)
        shots = manifest.get("shots")
        audio_data = manifest.get("audio")
        audio = audio_data.get("clips") if isinstance(audio_data, dict) else None
        if not isinstance(shots, list) or not shots:
            raise MasterRenderError("edit_package_has_no_video_shots")
        if not isinstance(audio, list) or not audio:
            raise MasterRenderError("edit_package_has_no_dialogue_audio")
        if not all(isinstance(shot, dict) for shot in shots) or not all(
            isinstance(clip, dict) for clip in audio
        ):
            raise MasterRenderError("edit_package_manifest_invalid")
        subtitle_path = work_dir / "subtitles" / "zh-CN.srt"
        if not subtitle_path.is_file():
            raise MasterRenderError("edit_package_subtitles_missing")
        audio = _align_audio_to_subtitles(audio, subtitle_path)
        video_paths = [_asset_path(work_dir, shot.get("asset")) for shot in shots]
        audio_paths = [_asset_path(work_dir, clip.get("asset")) for clip in audio]
        duration = sum(_positive_number(shot.get("duration_seconds_requested")) for shot in shots)
        if duration <= 0 or duration > 60 * 60:
            raise MasterRenderError("edit_package_duration_out_of_range")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _run_ffmpeg(
            binary=ffmpeg_binary,
            video_paths=video_paths,
            audio_paths=audio_paths,
            audio_clips=audio,
            subtitle_path=subtitle_path,
            output_path=output_path,
            width=width,
            height=height,
            duration=duration,
        )
    if not output_path.is_file():
        raise MasterRenderError("ffmpeg_render_output_missing")
    size_bytes = output_path.stat().st_size
    if size_bytes == 0:
        output_path.unlink(missing_ok=True)
        raise MasterRenderError("ffmpeg_render_output_empty")
    if size_bytes > MAX_MASTER_BYTES:
        output_path.unlink(missing_ok=True)
        raise MasterRenderError("rendered_master_exceeds_two_gigabytes")
    with output_path.open("rb") as file:
        if file.read(12)[4:8] != b"ftyp":
            output_path.unlink(missing_ok=True)
            raise MasterRenderError("rendered_master_is_not_mp4")
    return MasterRenderResult(size_bytes, _sha256(output_path), duration, width, height)


def _extract_package(package_path: Path, work_dir: Path) -> dict:
    if not package_path.is_file() or package_path.stat().st_size > MAX_PACKAGE_BYTES:
        raise MasterRenderError("edit_package_missing_or_too_large")
    try:
        with zipfile.ZipFile(package_path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            if not isinstance(manifest, dict):
                raise MasterRenderError("edit_package_manifest_invalid")
            shots = manifest.get("shots")
            audio_data = manifest.get("audio")
            audio = audio_data.get("clips") if isinstance(audio_data, dict) else None
            if (
                not isinstance(shots, list)
                or not all(isinstance(shot, dict) for shot in shots)
                or not isinstance(audio, list)
                or not all(isinstance(clip, dict) for clip in audio)
            ):
                raise MasterRenderError("edit_package_manifest_invalid")
            assets = [shot.get("asset") for shot in shots]
            assets.extend(clip.get("asset") for clip in audio)
            assets.append("subtitles/zh-CN.srt")
            total_size = 0
            for name in assets:
                _safe_relative_path(name)
                info = archive.getinfo(name)
                total_size += info.file_size
                if total_size > MAX_PACKAGE_BYTES:
                    raise MasterRenderError("edit_package_assets_too_large")
                relative = _safe_relative_path(name)
                target = (work_dir / Path(*relative.parts)).resolve()
                if work_dir.resolve() not in target.parents:
                    raise MasterRenderError("edit_package_asset_path_invalid")
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, target.open("wb") as destination:
                    shutil.copyfileobj(source, destination)
    except (
        KeyError,
        UnicodeDecodeError,
        json.JSONDecodeError,
        zipfile.BadZipFile,
        OSError,
        RuntimeError,
    ) as error:
        raise MasterRenderError("edit_package_invalid") from error
    return manifest


def _run_ffmpeg(
    *,
    binary: str,
    video_paths: list[Path],
    audio_paths: list[Path],
    audio_clips: list[dict],
    subtitle_path: Path,
    output_path: Path,
    width: int,
    height: int,
    duration: float,
) -> None:
    inputs = [binary, "-hide_banner", "-loglevel", "error", "-y"]
    for path in video_paths + audio_paths:
        inputs.extend(["-i", str(path)])
    inputs.extend(["-i", str(subtitle_path)])
    filters = []
    video_labels = []
    for index in range(len(video_paths)):
        label = f"v{index}"
        filters.append(
            f"[{index}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,"
            f"format=yuv420p,setpts=PTS-STARTPTS[{label}]"
        )
        video_labels.append(f"[{label}]")
    filters.append(f"{''.join(video_labels)}concat=n={len(video_paths)}:v=1:a=0[vout]")
    audio_labels = []
    audio_base = len(video_paths)
    for index, clip in enumerate(audio_clips):
        start_ms = clip.get("start_ms")
        if type(start_ms) is not int or start_ms < 0 or start_ms > duration * 1000:
            raise MasterRenderError("dialogue_audio_timing_invalid")
        label = f"a{index}"
        filters.append(
            f"[{audio_base + index}:a:0]asetpts=PTS-STARTPTS,aresample=48000,"
            f"adelay=delays={start_ms}:all=1[{label}]"
        )
        audio_labels.append(f"[{label}]")
    filters.append(
        f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:duration=longest:"
        f"dropout_transition=0:normalize=1,apad,atrim=duration={duration:.3f}[aout]"
    )
    subtitle_input = len(video_paths) + len(audio_paths)
    inputs.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-map",
            f"{subtitle_input}:s:0",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-c:s",
            "mov_text",
            "-movflags",
            "+faststart",
            "-t",
            f"{duration:.3f}",
            str(output_path),
        ]
    )
    try:
        result = subprocess.run(inputs, capture_output=True, timeout=1800, check=False)
    except subprocess.TimeoutExpired as error:
        output_path.unlink(missing_ok=True)
        raise MasterRenderError("ffmpeg_render_timed_out") from error
    except OSError as error:
        output_path.unlink(missing_ok=True)
        raise MasterRenderError("ffmpeg_execution_failed") from error
    if result.returncode != 0:
        output_path.unlink(missing_ok=True)
        raise MasterRenderError("ffmpeg_render_failed")


def _asset_path(work_dir: Path, value: object) -> Path:
    relative = _safe_relative_path(value)
    path = (work_dir / Path(*relative.parts)).resolve()
    if work_dir.resolve() not in path.parents or not path.is_file():
        raise MasterRenderError("edit_package_asset_missing")
    return path


def _safe_relative_path(value: object) -> PurePosixPath:
    if not isinstance(value, str):
        raise MasterRenderError("edit_package_asset_path_invalid")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise MasterRenderError("edit_package_asset_path_invalid")
    return path


def _positive_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise MasterRenderError("edit_package_shot_duration_invalid")
    return float(value)


def _align_audio_to_subtitles(audio_clips: list, subtitle_path: Path) -> list[dict]:
    try:
        subtitle = subtitle_path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise MasterRenderError("edit_package_subtitles_unreadable") from error
    cue_starts = []
    for block in re.split(r"\r?\n\s*\r?\n", subtitle.strip()):
        lines = block.splitlines()
        if len(lines) < 3 or not lines[0].strip().isdigit():
            raise MasterRenderError("edit_package_subtitles_invalid")
        match = re.fullmatch(
            r"(\d{2,}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+.+",
            lines[1].strip(),
        )
        if not match:
            raise MasterRenderError("edit_package_subtitles_invalid")
        hours, minutes, seconds, millis = (int(value) for value in match.groups())
        if minutes > 59 or seconds > 59:
            raise MasterRenderError("edit_package_subtitles_invalid")
        cue_starts.append(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
    aligned = []
    for clip in audio_clips:
        cue_index = clip.get("subtitle_index")
        if type(cue_index) is not int or not 1 <= cue_index <= len(cue_starts):
            raise MasterRenderError("dialogue_audio_subtitle_mapping_missing")
        aligned.append({**clip, "start_ms": cue_starts[cue_index - 1]})
    return aligned


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _dimensions(aspect_ratio: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d{1,3}):(\d{1,3})", aspect_ratio)
    if not match:
        raise MasterRenderError("unsupported_master_aspect_ratio")
    ratio_width, ratio_height = (int(value) for value in match.groups())
    if not ratio_width or not ratio_height:
        raise MasterRenderError("unsupported_master_aspect_ratio")
    if ratio_width >= ratio_height:
        width = 1280
        height = round((width * ratio_height / ratio_width) / 2) * 2
    else:
        height = 1280
        width = round((height * ratio_width / ratio_height) / 2) * 2
    if min(width, height) < 160:
        raise MasterRenderError("unsupported_master_aspect_ratio")
    return width, height
