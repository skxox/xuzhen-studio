import http.client
import ipaddress
import os
import re
import socket
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import ServiceProfile
from .common import audit


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        self.sock = socket.create_connection(
            (self.target_ip, self.port), self.timeout, self.source_address
        )


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, target_ip: str, **kwargs):
        super().__init__(host, port, **kwargs)
        self.target_ip = target_ip

    def connect(self):
        sock = socket.create_connection(
            (self.target_ip, self.port), self.timeout, self.source_address
        )
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def resolve_provider_secret(secret_ref: str | None) -> str | None:
    if not secret_ref:
        return None
    env_key = f"XZ_PROVIDER_SECRET_{re.sub(r'[^A-Z0-9_]', '_', secret_ref.upper())}"
    value = os.environ.get(env_key)
    if value:
        return value
    return next(
        (
            secret
            for key, secret in settings.provider_secrets.items()
            if key.casefold() == secret_ref.casefold()
        ),
        None,
    )


def validate_provider_target(endpoint: str, transport: str) -> list[str]:
    parsed = urlsplit(endpoint)
    hostname = parsed.hostname
    if not hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(422, "provider_endpoint_invalid")
    if parsed.scheme not in {"https", "http"}:
        raise HTTPException(422, "provider_endpoint_scheme_invalid")
    local_transport = transport in {"self_hosted_api", "local_runtime"}
    if parsed.scheme == "http" and not (local_transport and hostname in {"localhost", "127.0.0.1"}):
        raise HTTPException(422, "provider_endpoint_requires_https_or_loopback")
    try:
        try:
            addresses = {ipaddress.ip_address(hostname)}
        except ValueError:
            addresses = {
                ipaddress.ip_address(item[4][0].split("%", 1)[0])
                for item in socket.getaddrinfo(
                    hostname,
                    parsed.port or (443 if parsed.scheme == "https" else 80),
                    type=socket.SOCK_STREAM,
                )
            }
    except (OSError, ValueError):
        raise HTTPException(422, "provider_endpoint_dns_resolution_failed")
    if any(address.is_loopback for address in addresses) and not local_transport:
        raise HTTPException(422, "loopback_provider_requires_local_transport")
    allow_private = settings.allow_private_provider_endpoints and local_transport
    disallowed = any(
        not address.is_global
        and not (address.is_loopback and local_transport)
        and not allow_private
        for address in addresses
    )
    if not addresses or disallowed:
        raise HTTPException(422, "private_provider_endpoint_blocked")
    return [str(address) for address in addresses]


def persist_connection_test(
    db: Session, project_id: str, profile: ServiceProfile, result: dict
) -> None:
    capabilities = dict(profile.capabilities or {})
    capabilities["connection_test"] = result
    profile.capabilities = capabilities
    profile.enabled = result["status"] == "connected"
    profile.version += 1
    audit(
        db,
        project_id,
        "service_profile.connection_tested",
        profile.id,
        {
            "status": result["status"],
            "adapter_id": profile.adapter_id,
            "modality": profile.modality,
        },
    )
    db.commit()
