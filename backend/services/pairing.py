"""LAN pairing tokens.

A new client (mobile app, desktop shell) redeems a single-use, short-lived
pairing token at POST /api/auth/exchange to receive the long-lived JWT it
uses for every subsequent request. Tokens live in the settings table so the
CLI can mint them while the server is running (they share the same SQLite
file).
"""
import json
import secrets
import socket
import time

PAIRING_KEY = "pairing_tokens"
DEFAULT_TTL = 300  # seconds a pairing token stays redeemable


def _active(db):
    """Unexpired pairing tokens (expired rows are dropped on read)."""
    from models import Setting
    setting = db.query(Setting).filter(Setting.key == PAIRING_KEY).first()
    try:
        tokens = json.loads(setting.value) if setting else []
    except (TypeError, ValueError):
        tokens = []
    now = time.time()
    return [t for t in tokens if isinstance(t, dict) and t.get("expires", 0) > now]


def issue(db, ttl=DEFAULT_TTL):
    """Create a single-use pairing token. Returns (token, ttl_seconds)."""
    from models import Setting
    token = secrets.token_urlsafe(16)
    tokens = _active(db)
    tokens.append({"token": token, "expires": time.time() + ttl})
    setting = db.query(Setting).filter(Setting.key == PAIRING_KEY).first()
    if setting:
        setting.value = json.dumps(tokens)
    else:
        db.add(Setting(key=PAIRING_KEY, value=json.dumps(tokens)))
    db.commit()
    return token, int(ttl)


def consume(db, token):
    """Redeem a pairing token (single-use). Returns True if it was valid."""
    from models import Setting
    if not token:
        return False
    tokens = _active(db)
    remaining = [t for t in tokens if t.get("token") != token]
    if len(remaining) == len(tokens):
        return False
    setting = db.query(Setting).filter(Setting.key == PAIRING_KEY).first()
    setting.value = json.dumps(remaining)
    db.commit()
    return True


def lan_ip():
    """Best-effort primary LAN address (UDP connect trick; sends no traffic)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def is_local(request):
    """True when the request originates from the host itself."""
    host = request.client.host if request.client else None
    return host in ("127.0.0.1", "::1", "localhost")
