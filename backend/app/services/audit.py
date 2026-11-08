from sqlalchemy.orm import Session

from ..domain.models import AuditEvent


def audit(db: Session, project_id: str, event: str, entity: str, payload: dict) -> None:
    db.add(AuditEvent(project_id=project_id, event_type=event, entity_ref=entity, payload=payload))
