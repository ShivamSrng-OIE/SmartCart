"""Merchant sign-in for the warehouse portal. Shoppers never sign in; only sellers do.

Accounts are the warehouse merchants (their id is the username) plus an operator account ("warehouse"
by default) that can manage every store. Passwords come from the environment (MERCHANT_PASSWORD, one
demo password for every account), compared in constant time. A successful login returns a signed,
expiring token (HMAC-SHA256) that the portal sends as `Authorization: Bearer ...`. The signing secret
is generated on first run and kept in data/state/auth_secret (gitignored); no database, no sessions.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from app import config, paths
from app.warehouse import catalog

TOKEN_TTL_S = 12 * 3600
ADMIN_ROLE, MERCHANT_ROLE = "admin", "merchant"


def _secret() -> bytes:
    path = paths.STATE / "auth_secret"
    try:
        return path.read_bytes()
    except OSError:
        paths.ensure(paths.STATE)
        value = secrets.token_bytes(32)
        path.write_bytes(value)
        return value


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    return _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())


def accounts() -> dict[str, str]:
    """username -> role."""
    out = {config.MERCHANT_USERNAME: ADMIN_ROLE}
    out.update({mid: MERCHANT_ROLE for mid in catalog.merchants()})
    return out


def login(username: str, password: str) -> dict | None:
    username = (username or "").strip().lower()
    role = accounts().get(username)
    ok = hmac.compare_digest((password or "").encode(), config.MERCHANT_PASSWORD.encode())
    if role is None or not ok:
        return None
    payload = _b64(json.dumps({"sub": username, "role": role, "exp": int(time.time()) + TOKEN_TTL_S}).encode())
    return {"token": f"{payload}.{_sign(payload)}", "role": role, "username": username}


def verify(token: str | None) -> dict | None:
    if not token or token.count(".") != 1:
        return None
    payload, sig = token.split(".")
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    try:
        claims = json.loads(_unb64(payload))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(claims, dict) or claims.get("exp", 0) < time.time() or claims.get("sub") not in accounts():
        return None
    return claims


def bearer(header: str | None) -> str | None:
    if header and header.lower().startswith("bearer "):
        return header[7:].strip()
    return None
