import ipaddress
import json
import re
import ssl
from datetime import UTC, datetime
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    ServiceProfile,
)
from .common import (
    audit,
    get_db,
    project_or_404,
)
from .provider_security import (
    PinnedHTTPConnection,
    PinnedHTTPSConnection,
    persist_connection_test,
    resolve_provider_secret,
    validate_provider_target,
)
from .schemas import (
    ServiceProfileCreate,
)

router = APIRouter()


@router.post("/projects/{project_id}/service-profiles", status_code=201)
def create_profile(project_id: str, data: ServiceProfileCreate, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    endpoint = str(data.endpoint)
    if not endpoint.startswith("https://") and not re.match(
        r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", endpoint
    ):
        raise HTTPException(422, "endpoint_requires_https_or_loopback_http")
    p = ServiceProfile(project_id=project_id, **data.model_dump(mode="json"))
    db.add(p)
    db.flush()
    audit(
        db,
        project_id,
        "service_profile.created",
        p.id,
        {"modality": p.modality, "adapter_id": p.adapter_id},
    )
    db.commit()
    return {
        "id": p.id,
        "modality": p.modality,
        "name": p.name,
        "adapter_id": p.adapter_id,
        "transport": p.transport,
        "endpoint": p.endpoint,
        "model_id": p.model_id,
        "secret_ref": p.secret_ref,
        "secret_configured": resolve_provider_secret(p.secret_ref) is not None,
        "enabled": p.enabled,
        "version": p.version,
    }


@router.get("/projects/{project_id}/service-profiles")
def list_profiles(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    rows = db.scalars(select(ServiceProfile).where(ServiceProfile.project_id == project_id)).all()
    return [
        {
            "id": p.id,
            "modality": p.modality,
            "name": p.name,
            "adapter_id": p.adapter_id,
            "transport": p.transport,
            "endpoint": p.endpoint,
            "model_id": p.model_id,
            "secret_ref": p.secret_ref,
            "capabilities": p.capabilities,
            "enabled": p.enabled,
            "secret_configured": resolve_provider_secret(p.secret_ref) is not None,
            "connection_test": (p.capabilities or {}).get("connection_test"),
            "version": p.version,
        }
        for p in rows
    ]


@router.post("/projects/{project_id}/service-profiles/{profile_id}/test")
def test_service_profile(
    project_id: str, profile_id: str, request: Request, db: Session = Depends(get_db)
):
    client_host = request.client.host if request.client else ""
    try:
        is_loopback_client = ipaddress.ip_address(client_host).is_loopback
    except ValueError:
        is_loopback_client = False
    if not is_loopback_client:
        raise HTTPException(
            403, "provider_connection_test_local_only_until_authentication_is_enabled"
        )
    project_or_404(db, project_id)
    profile = db.get(ServiceProfile, profile_id)
    if not profile or profile.project_id != project_id:
        raise HTTPException(404, "service_profile_not_found")
    supported_profile = (
        (profile.modality == "text" and profile.adapter_id == "openai-compatible-chat")
        or (profile.modality == "image" and profile.adapter_id == "openai-compatible-image")
        or (profile.modality == "video" and profile.adapter_id == "openai-compatible-video")
        or (profile.modality == "audio" and profile.adapter_id == "openai-compatible-audio")
    )
    if not supported_profile:
        raise HTTPException(409, "connection_test_not_supported_for_adapter")

    tested_at = datetime.now(UTC).isoformat()
    try:
        secret = resolve_provider_secret(profile.secret_ref)
        if profile.secret_ref and not secret:
            raise HTTPException(409, "provider_secret_reference_not_configured")
        parsed = urlsplit(profile.endpoint)
        base = profile.endpoint.rstrip("/")
        model_url = (
            base
            if parsed.path.rstrip("/").endswith("/models")
            else f"{base}/models"
            if parsed.path.rstrip("/").endswith("/v1")
            else f"{base}/v1/models"
        )
        model_parsed = urlsplit(model_url)
        target_ips = validate_provider_target(model_url, profile.transport)
        request_path = model_parsed.path or "/"
        if model_parsed.query:
            request_path = f"{request_path}?{model_parsed.query}"
        port = model_parsed.port or (443 if model_parsed.scheme == "https" else 80)
        headers = {
            "Accept": "application/json",
            "User-Agent": "XuzhenStudio-ProviderCheck/1.0",
            "Host": model_parsed.netloc,
        }
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        connection_class = (
            PinnedHTTPSConnection if model_parsed.scheme == "https" else PinnedHTTPConnection
        )
        connection_kwargs = {"timeout": 10}
        if model_parsed.scheme == "https":
            connection_kwargs["context"] = ssl.create_default_context()
        connection = connection_class(
            model_parsed.hostname, port, target_ips[0], **connection_kwargs
        )
        try:
            connection.request("GET", request_path, headers=headers)
            response = connection.getresponse()
            status_code = response.status
            raw = response.read(1_000_001)
        finally:
            connection.close()
        if len(raw) > 1_000_000:
            raise HTTPException(502, "provider_models_response_too_large")
        if status_code != 200:
            code = (
                "provider_authentication_failed"
                if status_code in {401, 403}
                else "provider_rate_limited"
                if status_code == 429
                else "provider_endpoint_rejected"
            )
            raise HTTPException(502, code)
        payload = json.loads(raw)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise HTTPException(502, "provider_models_response_invalid")
        model_ids = {
            entry["id"]
            for entry in payload["data"]
            if isinstance(entry, dict) and isinstance(entry.get("id"), str)
        }
        if profile.model_id not in model_ids:
            raise HTTPException(422, "provider_model_not_found")
        result = {"status": "connected", "model_available": True, "checked_at": tested_at}
        persist_connection_test(db, project_id, profile, result)
        return {
            **result,
            "profile_id": profile.id,
            "execution_ready": True,
            "message": f"服务端已验证连接与模型 ID；该 {profile.modality} 服务可用于生成候选。",
        }
    except OSError as error:
        code = (
            "provider_connection_timeout"
            if isinstance(error, TimeoutError)
            else "provider_connection_failed"
        )
    except TimeoutError:
        code = "provider_connection_timeout"
    except (json.JSONDecodeError, UnicodeDecodeError):
        code = "provider_models_response_invalid"
    except HTTPException as error:
        code = str(error.detail)
        status_code = error.status_code
        result = {
            "status": "failed",
            "model_available": False,
            "checked_at": tested_at,
            "error_code": code,
        }
        persist_connection_test(db, project_id, profile, result)
        raise
    status_code = 502
    result = {
        "status": "failed",
        "model_available": False,
        "checked_at": tested_at,
        "error_code": code,
    }
    persist_connection_test(db, project_id, profile, result)
    raise HTTPException(status_code, code)
