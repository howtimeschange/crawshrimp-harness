"""Short-lived, one-use proofs that a Program was evaluated before activation.

Program evaluation itself remains pure in :mod:`core.automation_program`.  This
module deliberately stores no facts or checkpoints: a proof binds only the
canonical Program structure to a local process for a short time.  A backend
restart therefore safely requires the caller to test again rather than
silently trusting a stale client-side boolean.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import time
from collections.abc import Mapping

from core.automation_program import validate_program


PROOF_TTL_SECONDS = 10 * 60
_proofs: dict[str, tuple[str, float]] = {}


def program_fingerprint(program: Mapping) -> str:
    """Return a deterministic fingerprint after normal Program validation."""
    normalized = validate_program(program)
    payload = json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _prune(now: float) -> None:
    for proof, (_fingerprint, expires_at) in list(_proofs.items()):
        if expires_at <= now:
            _proofs.pop(proof, None)


def issue_program_test_proof(program: Mapping) -> str:
    """Issue an opaque proof for a successfully evaluated Program."""
    now = time.monotonic()
    _prune(now)
    proof = secrets.token_urlsafe(24)
    _proofs[proof] = (program_fingerprint(program), now + PROOF_TTL_SECONDS)
    return proof


def consume_program_test_proof(proof: str, program: Mapping) -> bool:
    """Atomically consume a valid proof for exactly the tested Program."""
    now = time.monotonic()
    _prune(now)
    token = str(proof or "").strip()
    stored = _proofs.pop(token, None)
    if not stored:
        return False
    fingerprint, expires_at = stored
    if expires_at <= now:
        return False
    try:
        return secrets.compare_digest(fingerprint, program_fingerprint(program))
    except (TypeError, ValueError):
        return False


def clear_program_test_proofs() -> None:
    """Test-only reset hook; production proofs naturally expire."""
    _proofs.clear()
