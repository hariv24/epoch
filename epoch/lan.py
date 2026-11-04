"""Tablet / LAN mode: who may talk to the server, device pairing, and the request guard.

The app has no login, so its safety has always been "only the owner's own computer can reach it".
LAN mode (opt-in) widens that to ONE more kind of client, a paired device on the home network:

* **owner**   - the request comes from loopback or from one of this Mac's own addresses.
* **device**  - a private-range address (10/8, 172.16/12, 192.168/16, fe80::/10, fd00::/8) that sends a
  valid `witness_device` cookie, while LAN mode is on.
* everything else is refused: a public address (403), LAN mode off (403), an unpaired private
  address (sent to /pair, and given no data).

Pairing: the owner makes a short-lived one-time pairing (6 digits + a long token, about 10 minutes).
The tablet enters the digits (or follows the QR link with the token) and receives a 256-bit random
device token in an HttpOnly, SameSite=Strict cookie. Only the SHA-256 of any secret is stored.
Wrong codes are rate-limited and a pairing is burned after 5 wrong guesses.

Never expose this port through a tunnel or reverse proxy (ngrok, cloudflared, nginx, Tailscale funnel):
those arrive from loopback. The guard refuses any "loopback" request that carries proxy headers, but it is
a safety net, not a licence.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import re
import secrets
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from typing import Any, Callable
from urllib.parse import urlsplit

from . import db, live, timeutil

log = logging.getLogger(__name__)

COOKIE_NAME = "witness_device"
COOKIE_MAX_AGE = 365 * 24 * 3600
PAIR_TTL_SECONDS = 600
MAX_PAIR_ATTEMPTS = 5            # wrong 6-digit guesses before a pairing is burned
LIMIT_WINDOW = timedelta(minutes=10)
LIMIT_PER_IP = 5                 # failed attempts per client address per window
LIMIT_GLOBAL = 20                # failed attempts from anywhere per window
LAST_SEEN_EVERY = timedelta(seconds=60)
DEVICE_IDLE_LIMIT = timedelta(days=90)   # a paired device unused this long must be paired again
# Headers a reverse proxy or tunnel adds; a browser on this computer never sends them.
PROXY_HEADERS = ("forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
                 "cf-connecting-ip", "via", "fly-client-ip", "true-client-ip", "x-original-forwarded-for")

# "epoch" and "epoch.local" are names the owner can point at this Mac with a hosts entry (127.0.0.1 epoch);
# "underdog" and "underdog.local" keep working for anyone who set that entry up before the rename.
STATIC_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "testserver",
                          "epoch", "epoch.local", "underdog", "underdog.local"})
# Paths a not-yet-paired private-network client may reach: the pairing page and the styles for it.
GUEST_PATHS = ("/pair", "/api/pair/redeem")
GUEST_PREFIXES = ("/static/",)
# Paths only the owner (the laptop) may use, even for a paired device.
OWNER_ONLY_PREFIXES = ("/api/pair/new", "/api/lan", "/api/devices", "/api/settings/lan", "/settings/lan")
# Things a paired device may read but not change: where reports go, the report itself, activity rules.
OWNER_ONLY_WRITES = ("/settings", "/settings/aw-rules", "/week/send", "/week/narrate")

# Private ranges a device may come from (spec: 10/8, 172.16/12, 192.168/16, fe80::/10, fd00::/8).
PRIVATE_NETS = tuple(ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fe80::/10", "fd00::/8",
))
LOOPBACK_NAMES = frozenset({"testclient"})  # Starlette's TestClient; real servers always report an IP


# --------------------------------------------------------------------------
# Secrets and hashing
# --------------------------------------------------------------------------

def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_device_token() -> str:
    return secrets.token_urlsafe(32)          # 256 bits


def new_pair_token() -> str:
    return secrets.token_urlsafe(16)          # 128 bits, 22 characters (keeps the QR small)


def new_pair_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


# --------------------------------------------------------------------------
# Addresses
# --------------------------------------------------------------------------

def _parse_ip(host: str | None) -> ipaddress._BaseAddress | None:
    if not host:
        return None
    host = host.strip().strip("[]").split("%", 1)[0]
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def is_private_ip(host: str | None) -> bool:
    ip = _parse_ip(host)
    if ip is None or ip.is_loopback:
        return False
    return any(ip in net for net in PRIVATE_NETS)


_addr_cache: dict[str, Any] = {"at": 0.0, "ips": []}
_addr_lock = threading.Lock()


def lan_ips() -> list[str]:
    """This computer's private IPv4 addresses, the one with the default route first. Cached for a minute."""
    with _addr_lock:
        if time.monotonic() - _addr_cache["at"] < 60 and _addr_cache["ips"]:
            return list(_addr_cache["ips"])
    found: list[str] = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("10.255.255.255", 1))     # a UDP "connect" sends nothing; it only picks the route
            found.append(sock.getsockname()[0])
        finally:
            sock.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    ips: list[str] = []
    for ip in found:
        if is_private_ip(ip) and ip not in ips:
            ips.append(ip)
    with _addr_lock:
        _addr_cache.update(at=time.monotonic(), ips=ips)
    return ips


def own_addresses() -> set[str]:
    return {"127.0.0.1", "::1", *lan_ips()}


_name_cache: dict[str, Any] = {"names": None}


def mdns_names() -> list[str]:
    """Names this Mac answers to on the network, lowercase: 'macbook.local' first, then the bare names."""
    if _name_cache["names"] is not None:
        return list(_name_cache["names"])
    labels: list[str] = []
    if sys.platform == "darwin":
        try:
            out = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True, timeout=2)
            if out.returncode == 0 and out.stdout.strip():
                labels.append(out.stdout.strip())
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        host = socket.gethostname()
        labels.append(host[:-6] if host.lower().endswith(".local") else host.split(".")[0])
    except OSError:
        pass
    names: list[str] = []
    for label in labels:
        label = label.strip().lower()
        if label and f"{label}.local" not in names:
            names.append(f"{label}.local")
    for label in labels:
        label = label.strip().lower()
        if label and label not in names:
            names.append(label)
    _name_cache["names"] = names
    return list(names)


def access_urls(port: int) -> list[dict[str, str]]:
    """The addresses to type on the tablet. The IP first: Android Chrome often cannot resolve .local names."""
    urls = [{"kind": "ip", "url": f"http://{ip}:{port}"} for ip in lan_ips()]
    names = [n for n in mdns_names() if n.endswith(".local")]
    urls += [{"kind": "hostname", "url": f"http://{name}:{port}"} for name in names[:1]]
    return urls


def pair_base_url(port: int, fallback_host: str | None = None) -> str:
    urls = access_urls(port)
    if urls:
        return urls[0]["url"]
    if fallback_host and (urlsplit("//" + fallback_host).hostname or "").lower() not in STATIC_HOSTS:
        return f"http://{fallback_host}"
    return f"http://127.0.0.1:{port}"


def classify_client(host: str | None) -> str:
    """'owner' (loopback or this Mac's own address), 'private' (home network) or 'public'/'unknown'."""
    if host in LOOPBACK_NAMES:
        return "owner"
    ip = _parse_ip(host)
    if ip is None:
        return "unknown"
    if ip.is_loopback or str(ip) in own_addresses():
        return "owner"
    return "private" if is_private_ip(str(ip)) else "public"


def allowed_host(host_header: str, lan_on: bool) -> bool:
    """The Host header allowlist (DNS-rebinding guard). Grows only while LAN mode is on."""
    host = (urlsplit("//" + host_header).hostname or "").lower()
    if host in STATIC_HOSTS:
        return True
    if not lan_on:
        return False
    if is_private_ip(host):
        return True
    return host in mdns_names()


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------

def lan_requested(config: Any, conn: sqlite3.Connection) -> bool:
    """LAN mode asked for, by .env (EPOCH_LAN=1) or the Settings toggle."""
    return bool(getattr(config, "lan", False)) or bool(db.get_setting(conn, "lan_enabled"))


def lan_status(state: Any, conn: sqlite3.Connection) -> dict[str, Any]:
    enabled = bool(db.get_setting(conn, "lan_enabled"))
    forced = bool(getattr(state.config, "lan", False))
    wanted = enabled or forced
    active = bool(getattr(state, "lan_active", False))
    return {"enabled": enabled, "forced_by_env": forced, "active": active, "restart_needed": wanted != active}


# --------------------------------------------------------------------------
# Rate limiting of wrong codes
# --------------------------------------------------------------------------

class AttemptLimiter:
    """Failed pairing attempts per client address and overall, inside a sliding window."""

    def __init__(self) -> None:
        self._fails: dict[str, list[datetime]] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()

    def _recent(self, key: str, now: datetime) -> list[datetime]:
        kept = [t for t in self._fails.get(key, []) if now - t < LIMIT_WINDOW]
        self._fails[key] = kept
        return kept

    def blocked(self, ip: str, now: datetime) -> bool:
        with self._lock:
            return len(self._recent(ip, now)) >= LIMIT_PER_IP or len(self._recent("*", now)) >= LIMIT_GLOBAL

    def fail(self, ip: str, now: datetime) -> None:
        with self._lock:
            self._recent(ip, now).append(now)
            self._recent("*", now).append(now)

    def reserve(self, ip: str, now: datetime) -> bool:
        """Atomically check the limits and count one attempt. False if the caller is blocked."""
        with self._lock:
            if len(self._recent(ip, now)) >= LIMIT_PER_IP or len(self._recent("*", now)) >= LIMIT_GLOBAL:
                return False
            self._recent(ip, now).append(now)
            self._recent("*", now).append(now)
            return True

    def refund(self, ip: str, now: datetime) -> None:
        """Take back one reserved attempt (the guess turned out right)."""
        with self._lock:
            for key in (ip, "*"):
                kept = self._recent(key, now)
                if kept:
                    kept.pop()


limiter = AttemptLimiter()


# --------------------------------------------------------------------------
# Pairing and devices
# --------------------------------------------------------------------------

def create_pairing(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, Any]:
    """A new one-time pairing; earlier unused ones are cancelled. Returns the secrets (shown once)."""
    now = now or timeutil.now_utc()
    code, token = new_pair_code(), new_pair_token()
    expires = now + timedelta(seconds=PAIR_TTL_SECONDS)
    # the owner asking for a fresh code clears any earlier lock-out (a guest's or the owner's own typos)
    limiter.reset()
    with db.transaction(conn):
        conn.execute("UPDATE pairings SET used_utc = ? WHERE used_utc IS NULL", (timeutil.to_iso(now),))
        conn.execute(
            "INSERT INTO pairings(code_hash, token_hash, created_utc, expires_utc) VALUES (?, ?, ?, ?)",
            (hash_secret("code:" + code), hash_secret("token:" + token), timeutil.to_iso(now), timeutil.to_iso(expires)),
        )
    return {"code": code, "token": token, "expires_at": timeutil.to_iso(expires), "ttl_seconds": PAIR_TTL_SECONDS}


def pending_pairing(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, Any] | None:
    now = now or timeutil.now_utc()
    row = conn.execute(
        "SELECT * FROM pairings WHERE used_utc IS NULL AND expires_utc > ? AND attempts < ? ORDER BY id DESC LIMIT 1",
        (timeutil.to_iso(now), MAX_PAIR_ATTEMPTS),
    ).fetchone()
    if row is None:
        return None
    left = int((timeutil.from_iso(row["expires_utc"]) - now).total_seconds())
    return {"expires_at": row["expires_utc"], "seconds_left": max(0, left)}


def device_name_from_ua(user_agent: str | None) -> str:
    ua = user_agent or ""
    system = next((name for needle, name in (
        ("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Macintosh", "Mac"),
        ("Windows", "Windows"), ("CrOS", "Chromebook"), ("Linux", "Linux")) if needle in ua), "Device")
    browser = next((name for needle, name in (
        ("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")) if needle in ua), "")
    return f"{system} · {browser}" if browser else system


def _clean_name(name: str | None) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())[:40]


def redeem(
    conn: sqlite3.Connection, *, code: str | None = None, token: str | None = None, user_agent: str | None = None,
    ip: str = "?", name: str | None = None, now: datetime | None = None,
) -> tuple[dict[str, Any] | None, str]:
    """Trade a pairing code or token for a device. Returns ({device, cookie_token}, "") or (None, reason).

    Reasons: rate_limited, invalid (bad or used or expired token), wrong_code, expired.
    """
    now = now or timeutil.now_utc()
    # Take the attempt first (check and count in one step), so a burst of parallel guesses cannot all slip past the limit.
    if not limiter.reserve(ip, now):
        return None, "rate_limited"
    try:
        result, reason = _redeem_reserved(conn, code=code, token=token, user_agent=user_agent, ip=ip, name=name, now=now)
    except BaseException:
        limiter.refund(ip, now)
        raise
    if result is not None:
        limiter.refund(ip, now)       # a right answer is not a failed attempt
    return result, reason


def _redeem_reserved(
    conn: sqlite3.Connection, *, code: str | None, token: str | None, user_agent: str | None, ip: str, name: str | None,
    now: datetime,
) -> tuple[dict[str, Any] | None, str]:
    stamp = timeutil.to_iso(now)
    cookie_token = new_device_token()
    with db.transaction(conn):                 # BEGIN IMMEDIATE: the guess budget below is spent atomically
        live_rows = conn.execute(
            "SELECT * FROM pairings WHERE used_utc IS NULL AND expires_utc > ? AND attempts < ?", (stamp, MAX_PAIR_ATTEMPTS)
        ).fetchall()
        match = None
        if token:
            digest = hash_secret("token:" + token.strip())
            match = next((r for r in live_rows if hmac.compare_digest(r["token_hash"], digest)), None)
            if match is None:
                return None, "invalid"
        else:
            digits = re.sub(r"\D", "", code or "")
            if len(digits) != 6:
                return None, "wrong_code"
            for r in live_rows:            # every guess counts against the open pairing(s) until it proves right
                conn.execute("UPDATE pairings SET attempts = attempts + 1 WHERE id = ?", (r["id"],))
            digest = hash_secret("code:" + digits)
            match = next((r for r in live_rows if hmac.compare_digest(r["code_hash"], digest)), None)
            if match is None:
                return None, "wrong_code"
            conn.execute("UPDATE pairings SET attempts = attempts - 1 WHERE id = ?", (match["id"],))
        claimed = conn.execute(
            "UPDATE pairings SET used_utc = ? WHERE id = ? AND used_utc IS NULL", (stamp, match["id"])
        ).rowcount
        if not claimed:
            return None, "invalid"
        cur = conn.execute(
            "INSERT INTO devices(name, user_agent, token_hash, created_utc, last_seen_utc, last_ip) VALUES (?, ?, ?, ?, ?, ?)",
            (_clean_name(name) or device_name_from_ua(user_agent), (user_agent or "")[:300], hash_secret("device:" + cookie_token),
             stamp, stamp, ip),
        )
        conn.execute("UPDATE pairings SET device_id = ? WHERE id = ?", (cur.lastrowid, match["id"]))
    return {"device": device_row(conn, int(cur.lastrowid)), "cookie_token": cookie_token}, ""


def device_row(conn: sqlite3.Connection, device_id: int) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
    return _device_dict(row) if row else None


def _device_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"], "user_agent": row["user_agent"], "created_utc": row["created_utc"],
        "last_seen_utc": row["last_seen_utc"], "last_ip": row["last_ip"],
    }


def list_devices(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [_device_dict(r) for r in conn.execute("SELECT * FROM devices WHERE revoked_utc IS NULL ORDER BY id")]


def revoke_device(conn: sqlite3.Connection, device_id: int, now: datetime | None = None) -> bool:
    now = now or timeutil.now_utc()
    cur = conn.execute(
        "UPDATE devices SET revoked_utc = ? WHERE id = ? AND revoked_utc IS NULL", (timeutil.to_iso(now), device_id)
    )
    return cur.rowcount > 0


def authenticate_device(
    conn: sqlite3.Connection, cookie_token: str | None, ip: str, now: datetime | None = None
) -> dict[str, Any] | None:
    """The device a cookie belongs to (not revoked), touching last_seen at most once a minute."""
    if not cookie_token or len(cookie_token) > 200:
        return None
    now = now or timeutil.now_utc()
    row = conn.execute(
        "SELECT * FROM devices WHERE token_hash = ? AND revoked_utc IS NULL", (hash_secret("device:" + cookie_token),)
    ).fetchone()
    if row is None:
        return None
    seen = row["last_seen_utc"]
    if seen is not None and now - timeutil.from_iso(seen) > DEVICE_IDLE_LIMIT:
        return None
    if seen is None or now - timeutil.from_iso(seen) >= LAST_SEEN_EVERY or row["last_ip"] != ip:
        conn.execute("UPDATE devices SET last_seen_utc = ?, last_ip = ? WHERE id = ?", (timeutil.to_iso(now), ip, row["id"]))
    return _device_dict(row)


def lan_info(state: Any, conn: sqlite3.Connection, port: int | None = None) -> dict[str, Any]:
    """The data behind GET /api/lan and the Settings panel."""
    port = port or state.config.port
    names = [n for n in mdns_names() if n.endswith(".local")]
    return {
        **lan_status(state, conn), "port": port, "hostname": names[0] if names else None,
        "urls": access_urls(port), "mac_url": f"http://epoch:{port}", "devices": list_devices(conn), "pairing": pending_pairing(conn),
    }


# --------------------------------------------------------------------------
# The request guard (pure ASGI, so streaming responses are untouched)
# --------------------------------------------------------------------------

@dataclass
class Decision:
    action: str                     # allow | reject | redirect
    role: str = "owner"             # owner | device | guest
    device_id: int | None = None
    status: int = 403
    message: str = ""
    code: str = ""


def _cookie_value(cookie_header: str, name: str) -> str | None:
    if not cookie_header:
        return None
    jar: SimpleCookie = SimpleCookie()
    try:
        jar.load(cookie_header)
    except Exception:
        return None
    morsel = jar.get(name)
    return morsel.value if morsel else None


def decide(
    state: Any, *, method: str, path: str, host: str, origin: str | None, cookie: str, client: str | None,
    wants_html: bool, now: datetime | None = None, proxied: bool = False, sec_fetch_site: str | None = None,
) -> Decision:
    """Pure decision for one request (see the module docstring)."""
    kind = classify_client(client)
    needs_lan_check = kind != "owner" or (urlsplit("//" + host).hostname or "").lower() not in STATIC_HOSTS
    lan_on = False
    if needs_lan_check:
        try:
            with db.get_conn(state.db_path) as conn:
                lan_on = lan_requested(state.config, conn)
        except Exception:
            log.exception("could not read the LAN setting")
    if not allowed_host(host, lan_on):
        return Decision("reject", status=400, message="Unexpected host name.", code="bad_host")
    if origin is not None and method not in ("GET", "HEAD", "OPTIONS"):
        if urlsplit(origin).netloc != host:
            return Decision("reject", status=403, message="Cross-site request refused.", code="cross_site")
    if kind == "owner":
        if proxied:
            # loopback plus proxy headers means a tunnel or reverse proxy is forwarding strangers to us
            return Decision("reject", status=403, message="Epoch does not answer through a proxy or tunnel.", code="proxied")
        if origin is None and method not in ("GET", "HEAD", "OPTIONS") and (sec_fetch_site or "").lower() == "cross-site":
            return Decision("reject", status=403, message="Cross-site request refused.", code="cross_site")
        return Decision("allow", role="owner")
    # --- a request from another machine ---
    if not lan_on:
        return Decision("reject", status=403, message="The server only answers this computer.", code="lan_off")
    if kind != "private":
        return Decision("reject", status=403, message="Only devices on the home network are allowed.", code="not_private")
    device = None
    try:
        with db.get_conn(state.db_path) as conn:
            device = authenticate_device(conn, _cookie_value(cookie, COOKIE_NAME), client or "?", now)
    except Exception:
        log.exception("device check failed")
    if device is not None:
        if any(path == p or path.startswith(p + "/") for p in OWNER_ONLY_PREFIXES):
            return Decision("reject", status=403, message="Only the computer running Epoch can do that.", code="owner_only")
        if method not in ("GET", "HEAD", "OPTIONS") and (
            path.rstrip("/") in OWNER_ONLY_WRITES or path.startswith("/settings/aw-rules/")
        ):
            return Decision("reject", status=403, message="Only the computer running Epoch can do that.", code="owner_only")
        return Decision("allow", role="device", device_id=device["id"])
    if path in GUEST_PATHS or any(path.startswith(p) for p in GUEST_PREFIXES):
        return Decision("allow", role="guest")
    if method in ("GET", "HEAD") and wants_html:
        return Decision("redirect", status=303, message="/pair", code="unpaired")
    return Decision("reject", status=401, message="This device is not paired.", code="unpaired")


class LanGuard:
    """ASGI middleware: Host allowlist, cross-site check, and the owner / paired-device rule."""

    def __init__(self, app: Any, get_state: Callable[[], Any]) -> None:
        self.app = app
        self.get_state = get_state

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        from fastapi.concurrency import run_in_threadpool
        from starlette.responses import JSONResponse, PlainTextResponse, RedirectResponse

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        path = scope.get("path", "/")
        client = scope["client"][0] if scope.get("client") else None
        accept = headers.get("accept", "")
        wants_html = "text/html" in accept or accept in ("", "*/*") and not path.startswith("/api/")
        decision = await run_in_threadpool(
            decide, self.get_state(), method=scope.get("method", "GET"), path=path, host=headers.get("host", ""),
            origin=headers.get("origin"), cookie=headers.get("cookie", ""), client=client, wants_html=wants_html,
            proxied=any(h in headers for h in PROXY_HEADERS), sec_fetch_site=headers.get("sec-fetch-site"),
        )
        if scope["type"] == "websocket" and decision.action != "allow":
            await send({"type": "websocket.close", "code": 1008})
            return
        if decision.action == "allow":
            scope["witness.role"] = decision.role
            scope["witness.device_id"] = decision.device_id
            token = live.current_client.set((headers.get("x-witness-client") or "")[:64] or None)
            try:
                await self.app(scope, receive, send)
            finally:
                live.current_client.reset(token)
            return
        if decision.action == "redirect":
            response: Any = RedirectResponse(decision.message, status_code=decision.status)
        elif path.startswith("/api/"):
            response = JSONResponse({"ok": False, "hint": decision.message, "code": decision.code}, status_code=decision.status)
        else:
            response = PlainTextResponse(decision.message, status_code=decision.status)
        await response(scope, receive, send)


def cookie_header_value(token: str, secure: bool = False) -> str:
    """The Set-Cookie value for a device token: HttpOnly, SameSite=Strict, a year long."""
    parts = [f"{COOKIE_NAME}={token}", "Path=/", f"Max-Age={COOKIE_MAX_AGE}", "HttpOnly", "SameSite=Strict"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)
