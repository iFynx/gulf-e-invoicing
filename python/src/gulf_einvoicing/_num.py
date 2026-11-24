"""Number helpers that match the JavaScript engines exactly (IEEE-754 doubles)."""
from __future__ import annotations

import math
import sys

_EPS = sys.float_info.epsilon


def r2(n: float) -> float:
    """Round to 2 decimals like ``Math.round((n + Number.EPSILON) * 100) / 100``."""
    return math.floor((n + _EPS) * 100 + 0.5) / 100


def money(n: float) -> str:
    """Two decimals, like ``r2(n).toFixed(2)``."""
    return f"{r2(n):.2f}"


def js_num(n: float | int) -> str:
    """String form of a number as JavaScript prints it (``2`` not ``2.0``)."""
    if isinstance(n, bool):
        raise TypeError("expected a number")
    if isinstance(n, int):
        return str(n)
    if math.isfinite(n) and n == int(n) and abs(n) < 1e21:
        return str(int(n))
    return repr(float(n))
