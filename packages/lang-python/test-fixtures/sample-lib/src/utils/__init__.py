"""Utility exports — module path must resolve to src/utils, not src/utils/__init__."""


def slugify(text: str) -> str:
    """Lowercases and hyphenates text."""
    return "-".join(text.lower().split())
