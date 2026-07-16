class Counter:
    """A counting fixture class."""

    def __init__(self, start: int = 0, step: int = 1) -> None:
        self.count = start
        self._step = step

    def increment(self) -> int:
        """Increments the counter and returns the new value."""
        self.count += self._step
        return self.count

    @property
    def is_positive(self) -> bool:
        return self.count > 0

    def _reset(self) -> None:
        self.count = 0
