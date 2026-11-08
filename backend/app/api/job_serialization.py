from ..domain.models import GenerationOutput


def safe_generation_output(item: GenerationOutput) -> dict:
    return {
        "id": item.id,
        "job_id": item.job_id,
        "content_type": item.content_type,
        "content": item.content,
        "metadata": item.metadata_json,
        "revision": item.revision,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }
