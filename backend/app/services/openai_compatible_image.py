import base64
import binascii
import http.client
import json
import socket
import ssl
from urllib.parse import urlsplit

from .openai_compatible import ProviderExecutionError


def _generation_url(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/images/generations"):
        return endpoint
    if path.endswith("/models"):
        path = path[: -len("/models")]
    if not path.endswith("/v1"):
        path = f"{path}/v1"
    return f"{parsed.scheme}://{parsed.netloc}{path}/images/generations"


def generate_image(
    *,
    endpoint: str,
    target_ip: str,
    model_id: str,
    secret: str | None,
    prompt: str,
    size: str,
    quality: str | None = None,
) -> tuple[bytes, str, dict]:
    parsed = urlsplit(_generation_url(endpoint))
    if not parsed.hostname or parsed.query or parsed.fragment:
        raise ProviderExecutionError("provider_endpoint_invalid", 422)
    if size not in {"1024x1024", "1536x1024", "1024x1536"}:
        raise ProviderExecutionError("unsupported_image_size", 422)
    payload = {
        "model": model_id,
        "prompt": prompt,
        "size": size,
        "n": 1,
        "response_format": "b64_json",
    }
    if quality is not None:
        if not isinstance(quality, str):
            raise ProviderExecutionError("unsupported_image_quality", 422)
        if quality not in {"standard", "hd", "high", "medium", "low"}:
            raise ProviderExecutionError("unsupported_image_quality", 422)
        payload["quality"] = quality
    raw_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Content-Length": str(len(raw_body)),
        "User-Agent": "XuzhenStudio-ImageGeneration/1.0",
        "Host": parsed.netloc,
    }
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    connection_class = _PinnedHTTPSConnection if parsed.scheme == "https" else _PinnedHTTPConnection
    kwargs = {"timeout": 180}
    if parsed.scheme == "https":
        kwargs["context"] = ssl.create_default_context()
    connection = connection_class(parsed.hostname, parsed.port, target_ip, **kwargs)
    try:
        connection.request("POST", parsed.path or "/", body=raw_body, headers=headers)
        response = connection.getresponse()
        status = response.status
        raw = response.read(24_000_001)
    except TimeoutError:
        raise ProviderExecutionError("provider_generation_timeout", 504) from None
    except OSError:
        raise ProviderExecutionError("provider_generation_connection_failed", 502) from None
    except http.client.HTTPException:
        raise ProviderExecutionError("provider_generation_protocol_error", 502) from None
    finally:
        connection.close()
    if len(raw) > 24_000_000:
        raise ProviderExecutionError("provider_generation_response_too_large", 502)
    if status != 200:
        code = (
            "provider_authentication_failed"
            if status in {401, 403}
            else "provider_rate_limited"
            if status == 429
            else "provider_generation_rejected"
        )
        raise ProviderExecutionError(code, 502)
    try:
        response_data = json.loads(raw)
        items = response_data.get("data") if isinstance(response_data, dict) else None
        encoded = items[0].get("b64_json") if isinstance(items, list) and items else None
        image = base64.b64decode(encoded, validate=True) if isinstance(encoded, str) else None
    except (json.JSONDecodeError, UnicodeDecodeError, binascii.Error, AttributeError, IndexError):
        raise ProviderExecutionError("provider_image_response_invalid", 502) from None
    if not image:
        raise ProviderExecutionError("provider_image_base64_required", 502)
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        content_type = "image/png"
    elif image.startswith(b"\xff\xd8\xff"):
        content_type = "image/jpeg"
    elif image.startswith(b"RIFF") and image[8:12] == b"WEBP":
        content_type = "image/webp"
    else:
        raise ProviderExecutionError("provider_image_format_unsupported", 502)
    if len(image) > 20_000_000:
        raise ProviderExecutionError("provider_image_too_large", 502)
    usage = response_data.get("usage", {})
    return image, content_type, usage if isinstance(usage, dict) else {}


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
