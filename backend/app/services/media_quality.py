import json
import math
import shutil
import subprocess
from pathlib import Path


class MediaProbeError(ValueError):
    """Raised when ffprobe cannot validate a media file."""


def ffprobe_available(binary: str) -> bool:
    executable = shutil.which(binary)
    if not executable:
        return False
    try:
        result = subprocess.run(
            [executable, "-version"], capture_output=True, timeout=5, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def inspect_master(
    *,
    path: Path,
    ffprobe_binary: str,
    expected_duration: float,
    expected_width: int,
    expected_height: int,
    expected_subtitle_count: int,
) -> dict:
    executable = shutil.which(ffprobe_binary)
    if not executable:
        raise MediaProbeError("ffprobe_unavailable")
    command = [
        executable,
        "-v",
        "error",
        "-count_packets",
        "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name,width,height,duration,nb_read_packets",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=300, check=False)
    except subprocess.TimeoutExpired as error:
        raise MediaProbeError("ffprobe_quality_check_timed_out") from error
    except OSError as error:
        raise MediaProbeError("ffprobe_execution_failed") from error
    if result.returncode != 0:
        raise MediaProbeError("ffprobe_quality_check_failed")
    payload = _parse_json(result.stdout)
    streams = payload.get("streams")
    container = payload.get("format")
    if not isinstance(streams, list) or not isinstance(container, dict):
        raise MediaProbeError("ffprobe_metadata_invalid")
    if not all(isinstance(stream, dict) for stream in streams):
        raise MediaProbeError("ffprobe_metadata_invalid")
    try:
        container_duration = float(container["duration"])
    except (KeyError, TypeError, ValueError) as error:
        raise MediaProbeError("ffprobe_metadata_invalid") from error
    if not math.isfinite(container_duration) or container_duration <= 0:
        raise MediaProbeError("ffprobe_metadata_invalid")
    if "mp4" not in container.get("format_name", "").split(","):
        raise MediaProbeError("master_container_is_not_mp4")
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    subtitles = [stream for stream in streams if stream.get("codec_type") == "subtitle"]
    if len(videos) != 1 or len(audios) != 1 or len(subtitles) != 1:
        raise MediaProbeError("master_required_streams_invalid")
    video, audio, subtitle = videos[0], audios[0], subtitles[0]
    if (
        video.get("codec_name") != "h264"
        or video.get("width") != expected_width
        or video.get("height") != expected_height
    ):
        raise MediaProbeError("master_video_stream_invalid")
    if audio.get("codec_name") != "aac" or subtitle.get("codec_name") != "mov_text":
        raise MediaProbeError("master_audio_or_subtitle_stream_invalid")
    if any(_packet_count(stream.get("nb_read_packets")) < 1 for stream in streams):
        raise MediaProbeError("master_stream_contains_no_packets")
    subtitle_packets = _packet_count(subtitle.get("nb_read_packets"))
    if subtitle_packets != expected_subtitle_count:
        raise MediaProbeError("master_subtitle_cue_count_mismatch")
    video_duration = _stream_duration(video, container_duration)
    audio_duration = _stream_duration(audio, container_duration)
    if not math.isfinite(video_duration) or not math.isfinite(audio_duration):
        raise MediaProbeError("ffprobe_metadata_invalid")
    tolerance = max(0.5, expected_duration * 0.01)
    duration_delta = abs(video_duration - expected_duration)
    if any(
        value <= 0 or abs(value - expected_duration) > tolerance
        for value in (container_duration, video_duration, audio_duration)
    ):
        raise MediaProbeError("master_duration_outside_tolerance")
    if abs(video_duration - audio_duration) > tolerance:
        raise MediaProbeError("master_audio_video_duration_mismatch")
    return {
        "passed": True,
        "container": "mp4",
        "actual_duration_seconds": video_duration,
        "container_duration_seconds": container_duration,
        "audio_duration_seconds": audio_duration,
        "expected_duration_seconds": expected_duration,
        "duration_delta_seconds": round(duration_delta, 3),
        "duration_tolerance_seconds": round(tolerance, 3),
        "video": {
            "codec": video["codec_name"],
            "width": video["width"],
            "height": video["height"],
            "packets_read": _packet_count(video["nb_read_packets"]),
        },
        "audio": {
            "codec": audio["codec_name"],
            "packets_read": _packet_count(audio["nb_read_packets"]),
        },
        "subtitle": {
            "codec": subtitle["codec_name"],
            "packets_read": subtitle_packets,
            "expected_packets": expected_subtitle_count,
        },
    }


def probe_audio_duration(path: Path, ffprobe_binary: str) -> float:
    return _probe_stream_duration(path, ffprobe_binary, "audio")


def probe_video_duration(path: Path, ffprobe_binary: str) -> float:
    return _probe_stream_duration(path, ffprobe_binary, "video")


def _probe_stream_duration(path: Path, ffprobe_binary: str, stream_type: str) -> float:
    executable = shutil.which(ffprobe_binary)
    if not executable:
        raise MediaProbeError("ffprobe_unavailable")
    command = [
        executable,
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=15, check=False)
    except subprocess.TimeoutExpired as error:
        raise MediaProbeError(f"ffprobe_{stream_type}_check_timed_out") from error
    except OSError as error:
        raise MediaProbeError("ffprobe_execution_failed") from error
    if result.returncode != 0:
        raise MediaProbeError(f"media_{stream_type}_probe_failed")
    payload = _parse_json(result.stdout)
    streams = payload.get("streams")
    if not isinstance(streams, list) or not any(
        isinstance(stream, dict) and stream.get("codec_type") == stream_type for stream in streams
    ):
        raise MediaProbeError(f"media_{stream_type}_stream_missing")
    matching_streams = [
        stream
        for stream in streams
        if isinstance(stream, dict) and stream.get("codec_type") == stream_type
    ]
    stream_durations = []
    for stream in matching_streams:
        try:
            stream_duration = float(stream["duration"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(stream_duration) and stream_duration > 0:
            stream_durations.append(stream_duration)
    try:
        format_duration = float(payload["format"]["duration"])
    except (KeyError, TypeError, ValueError):
        format_duration = 0
    duration = max(stream_durations, default=format_duration)
    if not math.isfinite(duration) or duration <= 0:
        raise MediaProbeError(f"media_{stream_type}_duration_invalid")
    return duration


def _parse_json(raw: bytes) -> dict:
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MediaProbeError("ffprobe_metadata_invalid") from error
    if not isinstance(payload, dict):
        raise MediaProbeError("ffprobe_metadata_invalid")
    return payload


def _packet_count(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _stream_duration(stream: dict, fallback: float) -> float:
    try:
        return float(stream.get("duration", fallback))
    except (TypeError, ValueError):
        return fallback
