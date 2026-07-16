MAX_LENGTH = 80


def truncate(text: str, limit: int = MAX_LENGTH) -> str:
    """Cuts text to the limit."""
    return text[:limit]
