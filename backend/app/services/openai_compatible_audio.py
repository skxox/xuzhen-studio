import http.client
import json
import socket
import ssl
from urllib.parse import urlsplit

from .openai_compatible import ProviderExecutionError

MAX_AUDIO_BYTES = 40_000_000
FORMATS = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
}


def _speech_url(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/audio/speech"):
        return endpoint
    if path.endswith("/models"):
        path = path[: -len("/models")]
    if not path.endswith("/v1"):
        path = f"{path}/v1"
    return f"{parsed.scheme}://{parsed.netloc}{path}/audio/speech"


def generate_speech(
    *,
    endpoint: str,
    target_ip: str,
    model_id: str,
    secret: str | None,
    text: str,
    voice: str,
    response_format: str,
    speed: float,
) -> tuple[bytes, str]:
    if response_format not in FORMATS:
        raise ProviderExecutionError("unsupported_speech_format", 422)
    if not 0.25 <= speed <= 4.0:
        raise ProviderExecutionError("unsupported_speech_speed", 422)
    if not voice or len(voice) > 120 or any(ord(char) < 32 for char in voice):
        raise ProviderExecutionError("invalid_speech_voice", 422)
    url = _speech_url(endpoint)
    parsed = urlsplit(url)
    if (
        not parsed.hostname
        or parsed.query
        or parsed.fragment
        or parsed.scheme not in {"http", "https"}
    ):
        raise ProviderExecutionError("provider_endpoint_invalid", 422)
    body = json.dumps(
        {
            "model": model_id,
            "input": text,
            "voice": voice,
            "response_format": response_format,
            "speed": speed,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    headers = {
        "Accept": FORMATS[response_format],
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
        "User-Agent": "XuzhenStudio-SpeechGeneration/1.0",
        "Host": parsed.netloc,
    }
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    connection_class = _PinnedHTTPSConnection if parsed.scheme == "https" else _PinnedHTTPConnection
    kwargs = {"timeout": 180}
    if parsed.scheme == "https":
        kwargs["context"] = ssl.create_default_context()
    connection = connection_class(parsed.hostname, port, target_ip, **kwargs)
    try:
        connection.request("POST", parsed.path or "/", body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        payload = response.read(MAX_AUDIO_BYTES + 1)
    except TimeoutError:
        raise ProviderExecutionError("provider_generation_timeout", 504) from None
    except OSError:
        raise ProviderExecutionError("provider_generation_connection_failed", 502) from None
    except http.client.HTTPException:
        raise ProviderExecutionError("provider_generation_protocol_error", 502) from None
    finally:
        connection.close()
    if len(payload) > MAX_AUDIO_BYTES:
        raise ProviderExecutionError("provider_audio_response_too_large", 502)
    if status != 200:
        code = (
            "provider_authentication_failed"
            if status in {401, 403}
            else "provider_rate_limited"
            if status == 429
            else "provider_generation_rejected"
        )
        raise ProviderExecutionError(code, 502)
    if not _matches_format(payload, response_format):
        raise ProviderExecutionError("provider_audio_format_invalid", 502)
    return payload, FORMATS[response_format]


def _matches_format(payload: bytes, response_format: str) -> bool:
    if response_format == "mp3":
        return payload.startswith(b"ID3") or (
            len(payload) > 2 and payload[0] == 0xFF and payload[1] & 0xE0 == 0xE0
        )
    if response_format == "wav":
        return len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WAVE"
    if response_format == "opus":
        return payload.startswith(b"OggS")
    if response_format == "aac":
        return len(payload) > 2 and payload[0] == 0xFF and payload[1] & 0xF6 == 0xF0
    if response_format == "flac":
        return payload.startswith(b"fLaC")
    return False


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        self.sock = socket.create_connection(
            (self.target_ip, self.port), self.timeout, self.source_address
        )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        sock = socket.create_connection(
            (self.target_ip, self.port), self.timeout, self.source_address
        )
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
