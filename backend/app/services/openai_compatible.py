import http.client
import json
import socket
import ssl
from urllib.parse import urlsplit


class ProviderExecutionError(Exception):
    def __init__(self, code: str, http_status: int = 502):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        self.sock = socket.create_connection((self.target_ip, self.port), self.timeout, self.source_address)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        sock = socket.create_connection((self.target_ip, self.port), self.timeout, self.source_address)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _completion_url(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        return endpoint
    if path.endswith("/models"):
        path = path[:-len("/models")]
    if not path.endswith("/v1"):
        path = f"{path}/v1"
    return f"{parsed.scheme}://{parsed.netloc}{path}/chat/completions"


def complete_chat(
    endpoint: str,
    target_ip: str,
    model_id: str,
    secret: str | None,
    prompt: str,
    parameters: dict,
) -> tuple[str, dict]:
    parsed = urlsplit(_completion_url(endpoint))
    if not parsed.hostname or parsed.query or parsed.fragment:
        raise ProviderExecutionError("provider_endpoint_invalid", 422)
    allowed = {"temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty", "seed", "stop"}
    unknown = set(parameters) - allowed
    if unknown:
        raise ProviderExecutionError("unsupported_generation_parameters", 422)
    bounds = {
        "temperature": (0, 2), "top_p": (0, 1), "max_tokens": (1, 16_384),
        "presence_penalty": (-2, 2), "frequency_penalty": (-2, 2),
    }
    for key, (minimum, maximum) in bounds.items():
        value = parameters.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))
                                  or key == "max_tokens" and not isinstance(value, int)
                                  or not minimum <= value <= maximum):
            raise ProviderExecutionError(f"invalid_generation_parameter:{key}", 422)
    if "seed" in parameters and (isinstance(parameters["seed"], bool)
                                  or not isinstance(parameters["seed"], int)):
        raise ProviderExecutionError("invalid_generation_parameter:seed", 422)
    stop = parameters.get("stop")
    if stop is not None and not (
        isinstance(stop, str) and len(stop) <= 256
        or isinstance(stop, list) and len(stop) <= 4
        and all(isinstance(item, str) and len(item) <= 256 for item in stop)
    ):
        raise ProviderExecutionError("invalid_generation_parameter:stop", 422)
    payload = {"model": model_id, "messages": [{"role": "user", "content": prompt}]}
    payload.update({key: parameters[key] for key in allowed if key in parameters})
    raw_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Content-Length": str(len(raw_body)),
        "User-Agent": "XuzhenStudio-TextGeneration/1.0",
        "Host": parsed.netloc,
    }
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    connection_class = _PinnedHTTPSConnection if parsed.scheme == "https" else _PinnedHTTPConnection
    connection_kwargs = {"timeout": 120}
    if parsed.scheme == "https":
        connection_kwargs["context"] = ssl.create_default_context()
    connection = connection_class(parsed.hostname, port, target_ip, **connection_kwargs)
    try:
        connection.request("POST", parsed.path or "/", body=raw_body, headers=headers)
        response = connection.getresponse()
        status = response.status
        raw = response.read(4_000_001)
    except TimeoutError:
        raise ProviderExecutionError("provider_generation_timeout", 504) from None
    except OSError:
        raise ProviderExecutionError("provider_generation_connection_failed", 502) from None
    except http.client.HTTPException:
        raise ProviderExecutionError("provider_generation_protocol_error", 502) from None
    finally:
        connection.close()
    if len(raw) > 4_000_000:
        raise ProviderExecutionError("provider_generation_response_too_large", 502)
    if status != 200:
        code = "provider_authentication_failed" if status in {401, 403} else "provider_rate_limited" if status == 429 else "provider_generation_rejected"
        raise ProviderExecutionError(code, 502)
    try:
        response_data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ProviderExecutionError("provider_generation_response_invalid", 502) from None
    choices = response_data.get("choices") if isinstance(response_data, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else None
    message = first.get("message") if isinstance(first, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "".join(
            item.get("text", "") for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)
        )
    if not isinstance(content, str) or not content.strip():
        raise ProviderExecutionError("provider_generation_empty_response", 502)
    usage = response_data.get("usage", {})
    if not isinstance(usage, dict):
        usage = {}
    return content, usage
