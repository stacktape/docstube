"""Greeting helpers for the docstube lang-python fixture."""

DEFAULT_GREETING = "Hello"


def greet(name: str, greeting: str = DEFAULT_GREETING) -> str:
    """Greets a user by name."""
    return f"{greeting}, {_format_name(name)}!"


async def fetch_greeting(user_id: int) -> str:
    """Pretends to load a greeting for a user."""
    return f"{DEFAULT_GREETING}, user {user_id}"


# Internal helper — must never surface as a public symbol.
def _format_name(name: str) -> str:
    return name.strip()
