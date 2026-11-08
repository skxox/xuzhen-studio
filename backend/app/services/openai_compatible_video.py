import http.client
import json
import re
import socket
import ssl
from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import uuid4

from .openai_compatible import ProviderExecutionError

MAX_VIDEO_BYTES = 256_000_000
MAX_JSON_BYTES = 1_000_000


@dataclass(frozen=True)
class VideoTask:
    task_id: str
    status: str
    progress: int
    error: dict


def _videos_url(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/videos"):
        return endpoint
    if path.endswith("/models"):
        path = path[: -len("/models")]
    elif path.endswith("/chat/completions"):
        path = path[: -len("/chat/completions")]
    if not path.endswith("/v1"):
        path = f"{path}/v1"
    return f"{parsed.scheme}://{parsed.netloc}{path}/videos"


def _request(
    *,
    endpoint: str,
    target_ip: str,
    secret: str | None,
    method: str,
    path: str,
    body: bytes | None = None,
    content_type: str | None = None,
    max_bytes: int = MAX_JSON_BYTES,
) -> tuple[int, bytes]:
    parsed = urlsplit(endpoint)
    if (
        not parsed.hostname
        or parsed.query
        or parsed.fragment
        or parsed.scheme not in {"http", "https"}
    ):
        raise ProviderExecutionError("provider_endpoint_invalid", 422)
    headers = {
        "Accept": "application/json",
        "Host": parsed.netloc,
        "User-Agent": "XuzhenStudio-VideoGeneration/1.0",
    }
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    if body is not None:
        headers["Content-Length"] = str(len(body))
    if content_type:
        headers["Content-Type"] = content_type
    connection_class = _PinnedHTTPSConnection if parsed.scheme == "https" else _PinnedHTTPConnection
    kwargs = {"timeout": 60 if method == "POST" else 45}
    if parsed.scheme == "https":
        kwargs["context"] = ssl.create_default_context()
    connection = connection_class(parsed.hostname, parsed.port, target_ip, **kwargs)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        payload = response.read(max_bytes + 1)
    except TimeoutError:
        raise ProviderExecutionError("provider_generation_timeout", 504) from None
    except OSError:
        raise ProviderExecutionError("provider_generation_connection_failed", 502) from None
    except http.client.HTTPException:
        raise ProviderExecutionError("provider_generation_protocol_error", 502) from None
    finally:
        connection.close()
    if len(payload) > max_bytes:
        raise ProviderExecutionError("provider_video_response_too_large", 502)
    return status, payload


def _status_error(status: int) -> ProviderExecutionError:
    code = (
        "provider_authentication_failed"
        if status in {401, 403}
        else "provider_rate_limited"
        if status == 429
        else "provider_task_not_found"
        if status == 404
        else "provider_generation_rejected"
    )
    return ProviderExecutionError(code, 502)


def submit_video(
    *,
    endpoint: str,
    target_ip: str,
    model_id: str,
    secret: str | None,
    prompt: str,
    input_reference: bytes,
    input_content_type: str,
    seconds: int,
    size: str,
) -> VideoTask:
    if seconds not in {4, 6, 8, 12}:
        raise ProviderExecutionError("unsupported_video_duration", 422)
    if size not in {"1280x720", "720x1280", "1024x1024"}:
        raise ProviderExecutionError("unsupported_video_size", 422)
    if input_content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise ProviderExecutionError("video_reference_format_unsupported", 422)
    boundary = f"xuzhen-{uuid4().hex}"
    fields = {"model": model_id, "prompt": prompt, "seconds": str(seconds), "size": size}
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[input_content_type]
    chunks.extend(
        [
            f"--{boundary}\r\n".encode(),
            (
                f'Content-Disposition: form-data; name="input_reference"; '
                f'filename="keyframe.{extension}"\r\n'
            ).encode(),
            f"Content-Type: {input_content_type}\r\n\r\n".encode(),
            input_reference,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    status, raw = _request(
        endpoint=_videos_url(endpoint),
        target_ip=target_ip,
        secret=secret,
        method="POST",
        path=urlsplit(_videos_url(endpoint)).path,
        body=b"".join(chunks),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    if status not in {200, 201, 202}:
        raise _status_error(status)
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ProviderExecutionError("provider_video_task_response_invalid", 502) from None
    task_id = data.get("id") if isinstance(data, dict) else None
    if not isinstance(task_id, str) or not task_id or len(task_id) > 240:
        raise ProviderExecutionError("provider_video_task_id_missing", 502)
    task_status = _normalize_status(data.get("status", "queued"))
    return VideoTask(task_id, task_status, _progress(data.get("progress")), {})


def retrieve_video(
    *,
    endpoint: str,
    target_ip: str,
    secret: str | None,
    task_id: str,
) -> VideoTask:
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,240}", task_id):
        raise ProviderExecutionError("provider_video_task_id_invalid", 422)
    videos_url = _videos_url(endpoint)
    base_path = urlsplit(videos_url).path.rstrip("/")
    status, raw = _request(
        endpoint=videos_url,
        target_ip=target_ip,
        secret=secret,
        method="GET",
        path=f"{base_path}/{task_id}",
    )
    if status != 200:
        raise _status_error(status)
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ProviderExecutionError("provider_video_status_invalid", 502) from None
    if not isinstance(data, dict):
        raise ProviderExecutionError("provider_video_status_invalid", 502)
    raw_error = data.get("error")
    error = (
        raw_error
        if isinstance(raw_error, dict)
        else {"message": str(raw_error)}
        if raw_error
        else {}
    )
    return VideoTask(
        task_id, _normalize_status(data.get("status")), _progress(data.get("progress")), error
    )


def download_video(*, endpoint: str, target_ip: str, secret: str | None, task_id: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,240}", task_id):
        raise ProviderExecutionError("provider_video_task_id_invalid", 422)
    videos_url = _videos_url(endpoint)
    content_path = f"{urlsplit(videos_url).path.rstrip('/')}/{task_id}/content"
    status, payload = _request(
        endpoint=videos_url,
        target_ip=target_ip,
        secret=secret,
        method="GET",
        path=content_path,
        max_bytes=MAX_VIDEO_BYTES,
    )
    if status != 200:
        raise _status_error(status)
    if len(payload) < 12 or payload[4:8] != b"ftyp":
        raise ProviderExecutionError("provider_video_mp4_invalid", 502)
    return payload


def _normalize_status(value: object) -> str:
    if value in {"queued", "pending", "processing", "in_progress", "running"}:
        return "processing"
    if value in {"completed", "succeeded", "success"}:
        return "completed"
    if value in {"failed", "cancelled", "canceled", "expired"}:
        return "failed"
    raise ProviderExecutionError("provider_video_status_unknown", 502)


def _progress(value: object) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return min(100, max(0, value))
    return 0


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int | None, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        self.sock = socket.create_connection(
            (self.target_ip, self.port), self.timeout, self.source_address
        )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int | None, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        sock = socket.create_connection(
            (self.target_ip, self.port), self.timeout, self.source_address
        )
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
