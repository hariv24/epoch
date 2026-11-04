"""Tablet / LAN mode: who may reach the server, pairing, devices, rate limits."""
from __future__ import annotations

import re
from datetime import timedelta

import pytest

from epoch import db, lan

TABLET = "192.168.1.40"


def set_lan(db_path, on=True):
    with db.get_conn(db_path) as conn:
        db.set_setting(conn, "lan_enabled", on)


def rows(db_path, sql, *params):
    with db.get_conn(db_path) as conn:
        return conn.execute(sql, params).fetchall()


def pair(owner, from_addr, ip=TABLET, **form):
    """Run the whole pairing and return (device client, pairing payload)."""
    created = owner.post("/api/pair/new").json()
    assert created["ok"], created
    device = from_addr(ip)
    response = device.post("/pair", data={"code": created["code"], **form})
    assert response.status_code == 303 and response.headers["location"] == "/", response.text
    return device, created


# --------------------------------------------------------------------------
# The access matrix
# --------------------------------------------------------------------------

def test_loopback_is_the_owner_with_or_without_lan_mode(owner, v2_state):
    assert owner.get("/api/today").status_code == 200
    set_lan(v2_state.db_path)
    assert owner.get("/api/today").status_code == 200
    assert owner.get("/api/session").json()["role"] == "owner"


@pytest.mark.parametrize("ip", ["127.0.0.1", "::1", "::ffff:127.0.0.1", "testclient"])
def test_every_loopback_spelling_is_the_owner(from_addr, ip):
    assert from_addr(ip, "127.0.0.1:8765").get("/api/today").status_code == 200


def test_the_macs_own_lan_address_is_the_owner(from_addr, v2_state):
    set_lan(v2_state.db_path)
    # the Mac browsing its own LAN address (lan_ips is stubbed to 192.168.1.23 in conftest)
    assert from_addr("192.168.1.23").get("/api/session").json()["role"] == "owner"


def test_other_machines_are_refused_while_lan_mode_is_off(from_addr):
    response = from_addr(TABLET, "127.0.0.1:8765").get("/api/today")
    assert response.status_code == 403 and response.json()["code"] == "lan_off"
    assert from_addr(TABLET, "127.0.0.1:8765").get("/", headers={"accept": "text/html"}).status_code == 403
    assert from_addr(TABLET).get("/api/today").status_code == 400      # a LAN host name is not even accepted


@pytest.mark.parametrize("ip", ["8.8.8.8", "93.184.216.34", "100.64.1.1", "172.32.0.1", "11.0.0.1", "2001:4860:4860::8888", "169.254.1.1"])
def test_public_addresses_are_denied_even_with_lan_mode_on_and_a_valid_cookie(owner, from_addr, v2_state, ip):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    stolen = device.cookies.get(lan.COOKIE_NAME)
    assert stolen
    attacker = from_addr(ip, "192.168.1.23:8765")
    attacker.cookies.set(lan.COOKIE_NAME, stolen)
    response = attacker.get("/api/today")
    assert response.status_code == 403 and response.json()["code"] == "not_private"


@pytest.mark.parametrize("ip", ["10.1.2.3", "172.16.5.5", "172.31.255.1", "192.168.0.9", "fe80::1", "fd12:3456::7", "::ffff:192.168.1.50"])
def test_private_ranges_can_pair_and_then_use_the_app(owner, from_addr, v2_state, ip):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr, ip=ip, name="Tab")
    assert device.get("/api/today").status_code == 200
    assert device.get("/api/session").json()["role"] == "device"


def test_unpaired_private_address_gets_the_pair_page_and_no_data(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    stranger = from_addr(TABLET)
    page = stranger.get("/", headers={"accept": "text/html"})
    assert page.status_code == 303 and page.headers["location"] == "/pair"
    for path in ("/api/today", "/api/world", "/api/shelf", "/api/pomodoro", "/api/stream", "/api/weather", "/settings", "/health"):
        response = stranger.get(path)
        assert response.status_code in (303, 401), path
        assert "floors" not in response.text and "deep_minutes" not in response.text
    assert stranger.post("/api/log", json={"text": "30m math"}).status_code == 401
    pair_page = stranger.get("/pair")
    assert pair_page.status_code == 200 and 'name="code"' in pair_page.text
    assert "Epoch" in pair_page.text and "run-pill" not in pair_page.text and "data-today" not in pair_page.text
    assert stranger.get("/static/app/style.css").status_code == 200


def test_revoked_device_is_denied_at_once(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    assert device.get("/api/today").status_code == 200
    device_id = owner.get("/api/devices").json()["devices"][0]["id"]
    assert owner.post(f"/api/devices/{device_id}/revoke").json()["ok"] is True
    after = device.get("/api/today")
    assert after.status_code == 401
    assert device.get("/", headers={"accept": "text/html"}).headers["location"] == "/pair"
    assert owner.get("/api/devices").json()["devices"] == []
    assert owner.post(f"/api/devices/{device_id}/revoke").json()["ok"] is False
    assert rows(v2_state.db_path, "SELECT revoked_utc FROM devices")[0]["revoked_utc"]


def test_turning_lan_mode_off_locks_paired_devices_out(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    set_lan(v2_state.db_path, False)
    assert device.get("/api/today").status_code in (400, 403)


def test_a_garbage_cookie_is_just_unpaired(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device = from_addr(TABLET)
    device.cookies.set(lan.COOKIE_NAME, "x" * 500)
    assert device.get("/api/today").status_code == 401


def test_devices_cannot_use_owner_only_endpoints(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    assert device.post("/api/pair/new").status_code == 403
    assert device.get("/api/lan").status_code == 403
    assert device.get("/api/devices").status_code == 403
    assert device.post("/api/devices/1/revoke").status_code == 403
    assert device.post("/api/settings/lan", json={"enabled": False}).status_code == 403
    assert device.get("/settings/lan").status_code == 403
    assert device.post("/settings/lan/pair").status_code == 403
    assert rows(v2_state.db_path, "SELECT value FROM settings WHERE key = 'lan_enabled'")[0]["value"] == "true"


# --------------------------------------------------------------------------
# Host header and Origin
# --------------------------------------------------------------------------

def test_lan_hosts_are_accepted_only_while_lan_mode_is_on(owner, from_addr, v2_state):
    assert from_addr("127.0.0.1", "192.168.1.23:8765").get("/api/today").status_code == 400
    assert from_addr("127.0.0.1", "test-mac.local:8765").get("/api/today").status_code == 400
    set_lan(v2_state.db_path)
    assert from_addr("127.0.0.1", "192.168.1.23:8765").get("/api/today").status_code == 200
    assert from_addr("127.0.0.1", "test-mac.local:8765").get("/api/today").status_code == 200
    assert from_addr("127.0.0.1", "10.9.8.7:8765").get("/api/today").status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8765", "test-mac.local.evil.example", "8.8.8.8:8765", "other.local:8765"])
def test_look_alike_hosts_are_refused_even_with_lan_mode_on(owner, from_addr, v2_state, host):
    set_lan(v2_state.db_path)
    assert from_addr("127.0.0.1", host).get("/api/today").status_code == 400
    device, _ = pair(owner, from_addr)
    device.headers["host"] = host
    assert device.get("/api/today").status_code == 400


def test_cross_site_posts_are_refused_for_devices_too(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    bad = device.post("/api/log", json={"text": "30m math"}, headers={"origin": "http://evil.example"})
    assert bad.status_code == 403
    good = device.post("/api/log", json={"text": "30m math"}, headers={"origin": "http://192.168.1.23:8765"})
    assert good.status_code == 200 and good.json()["ok"] is True


# --------------------------------------------------------------------------
# Pairing
# --------------------------------------------------------------------------

def test_pairing_needs_lan_mode(owner):
    body = owner.post("/api/pair/new").json()
    assert body["ok"] is False and body["code"] == "lan_off"


def test_pairing_payload_has_code_token_url_and_a_scannable_qr(owner, v2_state):
    set_lan(v2_state.db_path)
    body = owner.post("/api/pair/new", headers={"host": "127.0.0.1:8765"}).json()
    assert re.fullmatch(r"\d{6}", body["code"]) and len(body["token"]) >= 20 and body["ttl_seconds"] == 600
    assert body["url"] == f"http://192.168.1.23:8765/pair?t={body['token']}"
    assert body["pair_page"] == "http://192.168.1.23:8765/pair"
    assert body["urls"][0] == {"kind": "ip", "url": "http://192.168.1.23:8765"}
    assert body["urls"][1] == {"kind": "hostname", "url": "http://test-mac.local:8765"}
    assert body["qr"]["svg"].startswith("<svg") and body["qr"]["size"] == len(body["qr"]["modules"])
    assert body["restart_needed"] is True       # nothing is listening on the network yet in this test
    # the QR encodes exactly the pairing URL
    from tests.test_qr import read_back
    matrix = [[c == "1" for c in row] for row in body["qr"]["modules"]]
    assert read_back(matrix)[0] == body["url"]


def test_only_hashes_are_stored(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device, created = pair(owner, from_addr)
    cookie = device.cookies.get(lan.COOKIE_NAME)
    dump = " ".join(str(tuple(r)) for t in ("pairings", "devices") for r in rows(v2_state.db_path, f"SELECT * FROM {t}"))
    for secret in (created["code"], created["token"], cookie):
        assert secret not in dump
    assert len(cookie) >= 40


def test_cookie_flags(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    response = from_addr(TABLET).post("/pair", data={"code": created["code"]})
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{lan.COOKIE_NAME}=") and "HttpOnly" in cookie and "SameSite=Strict" in cookie and "Path=/" in cookie


def test_token_link_pairs_in_one_visit_and_only_once(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    tablet = from_addr(TABLET)
    first = tablet.get(f"/pair?t={created['token']}")
    assert first.status_code == 303 and first.headers["location"] == "/" and lan.COOKIE_NAME in first.headers["set-cookie"]
    assert tablet.get("/api/today").status_code == 200
    second = from_addr("192.168.1.41").get(f"/pair?t={created['token']}")
    assert second.status_code == 400 and "set-cookie" not in second.headers
    assert from_addr("192.168.1.41").post("/pair", data={"code": created["code"]}).status_code == 400


def test_pairing_expires_after_ten_minutes(owner, from_addr, v2_state, v2_clock):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    v2_clock.advance(minutes=10, seconds=1)
    assert from_addr(TABLET).post("/pair", data={"code": created["code"]}).status_code == 400
    assert from_addr(TABLET).get(f"/pair?t={created['token']}").status_code == 400


def test_a_new_pairing_cancels_the_old_one(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    old = owner.post("/api/pair/new").json()
    new = owner.post("/api/pair/new").json()
    assert from_addr(TABLET).post("/pair", data={"code": old["code"]}).status_code == 400
    assert from_addr(TABLET).post("/pair", data={"code": new["code"]}).status_code == 303


def test_code_may_be_typed_with_a_space(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    spaced = created["code"][:3] + " " + created["code"][3:]
    assert from_addr(TABLET).post("/pair", data={"code": spaced}).status_code == 303


def test_five_wrong_codes_burn_the_pairing(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    wrong = "000000" if created["code"] != "000000" else "111111"
    for i in range(5):
        # different addresses, so the per-address limit does not interfere
        assert from_addr(f"192.168.1.{50 + i}").post("/pair", data={"code": wrong}).status_code == 400
    assert from_addr("192.168.1.99").post("/pair", data={"code": created["code"]}).status_code == 400
    assert owner.get("/api/lan").json()["pairing"] is None


def test_wrong_codes_from_one_address_are_rate_limited(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    wrong = "000000" if created["code"] != "000000" else "111111"
    tablet = from_addr(TABLET)
    statuses = [tablet.post("/pair", data={"code": wrong}).status_code for _ in range(5)]
    assert statuses == [400] * 5
    blocked = tablet.post("/pair", data={"code": created["code"]})
    assert blocked.status_code == 429 and "Wait" in blocked.text
    api = tablet.post("/api/pair/redeem", json={"code": created["code"]})
    assert api.status_code == 429 and api.json()["code"] == "rate_limited"


def test_rate_limit_window_expires(owner, from_addr, v2_state, v2_clock):
    set_lan(v2_state.db_path)
    wrong = "000000"
    tablet = from_addr(TABLET)
    for _ in range(5):
        tablet.post("/pair", data={"code": wrong})
    v2_clock.advance(minutes=10, seconds=1)
    created = owner.post("/api/pair/new").json()
    assert tablet.post("/pair", data={"code": created["code"]}).status_code == 303


def test_global_limit_blocks_everyone_until_the_owner_makes_a_new_code(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    first = owner.post("/api/pair/new").json()
    for i in range(lan.LIMIT_GLOBAL):
        from_addr(f"192.168.2.{i + 1}").post("/pair", data={"code": "000000"})
    assert from_addr("192.168.3.3").post("/pair", data={"code": first["code"]}).status_code == 429
    # the owner asking for a fresh code is a deliberate act, so it clears the lock-out
    created = owner.post("/api/pair/new").json()
    assert from_addr("192.168.3.3").post("/pair", data={"code": created["code"]}).status_code == 303


def test_parallel_guesses_cannot_beat_the_attempt_limit(v2_state):
    import threading
    from datetime import datetime, timezone

    lan.limiter.reset()
    with db.get_conn(v2_state.db_path) as conn:
        lan.create_pairing(conn)
    outcomes: list[str] = []
    gate = threading.Barrier(40)

    def guess() -> None:
        with db.get_conn(v2_state.db_path) as conn:
            gate.wait()
            _result, reason = lan.redeem(conn, code="000000", ip="192.168.9.9", now=datetime.now(timezone.utc))
            outcomes.append(reason)

    threads = [threading.Thread(target=guess) for _ in range(40)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert outcomes.count("rate_limited") >= 35 and outcomes.count("wrong_code") <= lan.LIMIT_PER_IP
    with db.get_conn(v2_state.db_path) as conn:
        assert conn.execute("SELECT MAX(attempts) FROM pairings").fetchone()[0] <= lan.MAX_PAIR_ATTEMPTS


def test_proxied_loopback_requests_are_refused(owner, v2_state):
    assert owner.get("/api/lan").status_code == 200
    for header in ("X-Forwarded-For", "Forwarded", "X-Real-IP", "CF-Connecting-IP", "Via", "X-Forwarded-Host"):
        response = owner.get("/api/lan", headers={header: "8.8.8.8"})
        assert response.status_code == 403 and response.json()["code"] == "proxied", header
    cross = owner.post("/api/pair/new", headers={"Sec-Fetch-Site": "cross-site"})
    assert cross.status_code == 403 and cross.json()["code"] == "cross_site"


def test_paired_devices_cannot_redirect_reports_or_edit_rules(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    for path in ("/settings", "/settings/aw-rules", "/week/send", "/week/narrate"):
        response = device.post(path, data={})
        assert response.status_code == 403, path
    assert device.post("/settings/aw-rules/1/delete").status_code == 403
    assert device.get("/settings").status_code == 200
    assert device.post("/api/settings/game", json={"theme": "dark"}).status_code != 403


def test_an_idle_device_must_pair_again(owner, from_addr, v2_state, v2_clock):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    assert device.get("/api/lan").status_code in (200, 403)     # owner-only, but recognised
    v2_clock.advance(days=lan.DEVICE_IDLE_LIMIT.days + 1)
    assert device.get("/api/pomodoro").status_code == 401


def test_json_redeem_and_device_name(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    ua = "Mozilla/5.0 (Linux; Android 14; RMP2402) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
    tablet = from_addr(TABLET)
    response = tablet.post("/api/pair/redeem", json={"code": created["code"]}, headers={"user-agent": ua})
    body = response.json()
    assert body["ok"] and body["device"]["name"] == "Android · Chrome" and lan.COOKIE_NAME in response.headers["set-cookie"]
    listed = owner.get("/api/devices").json()["devices"]
    assert listed[0]["name"] == "Android · Chrome" and listed[0]["last_ip"] == TABLET and "RMP2402" in listed[0]["user_agent"]


def test_custom_device_name(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    pair(owner, from_addr, name="  Realme   Pad  ")
    assert owner.get("/api/devices").json()["devices"][0]["name"] == "Realme Pad"


def test_the_owner_cannot_pair_itself_and_a_paired_device_is_sent_home(owner, from_addr, v2_state):
    set_lan(v2_state.db_path)
    created = owner.post("/api/pair/new").json()
    page = owner.get(f"/pair?t={created['token']}")
    assert page.status_code == 200 and "set-cookie" not in page.headers and "computer running Epoch" in page.text
    assert owner.post("/api/pair/redeem", json={"code": created["code"]}).json()["ok"] is False
    device, _ = pair(owner, from_addr)
    assert device.get("/pair").headers["location"] == "/"


def test_last_seen_is_touched_at_most_once_a_minute(owner, from_addr, v2_state, v2_clock):
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    first = owner.get("/api/devices").json()["devices"][0]["last_seen_utc"]
    v2_clock.advance(seconds=20)
    device.get("/api/today")
    assert owner.get("/api/devices").json()["devices"][0]["last_seen_utc"] == first
    v2_clock.advance(seconds=60)
    device.get("/api/today")
    assert owner.get("/api/devices").json()["devices"][0]["last_seen_utc"] > first


# --------------------------------------------------------------------------
# Settings, status, pages
# --------------------------------------------------------------------------

def test_lan_settings_roundtrip_and_restart_hint(owner, v2_state):
    off = owner.get("/api/lan").json()
    assert off["enabled"] is False and off["active"] is False and off["restart_needed"] is False and off["port"] == 8765
    on = owner.post("/api/settings/lan", json={"enabled": True}).json()
    assert on["ok"] and on["enabled"] is True and on["restart_needed"] is True
    v2_state.lan_active = True
    assert owner.get("/api/lan").json()["restart_needed"] is False
    assert owner.post("/api/settings/lan", json={"enabled": False}).json()["restart_needed"] is True
    assert owner.post("/api/settings/lan", json={}).json()["ok"] is False


def test_env_flag_forces_lan_on(owner, v2_state):
    from dataclasses import replace
    v2_state.config = replace(v2_state.config, lan=True)
    info = owner.get("/api/lan").json()
    assert info["forced_by_env"] is True and info["restart_needed"] is True
    assert owner.post("/api/pair/new").json()["ok"] is True


def test_lan_page_and_form_flow(owner, v2_state):
    html = owner.get("/settings/lan").text
    assert "Tablet mode" in html and "No devices paired yet" in html
    assert owner.post("/settings/lan", data={"enabled": "1"}, follow_redirects=False).status_code == 303
    assert owner.get("/api/lan").json()["enabled"] is True
    page = owner.post("/settings/lan/pair").text
    assert 'data-js="pairing-qr"' in page and "<svg" in page and re.search(r"\b\d{6}\b", page)
    assert "192.168.1.23:8765" in page


def test_lan_address_helpers():
    assert lan.is_private_ip("10.0.0.1") and lan.is_private_ip("fd00::1") and lan.is_private_ip("[fe80::1]")
    assert not lan.is_private_ip("127.0.0.1") and not lan.is_private_ip("8.8.8.8") and not lan.is_private_ip("nonsense")
    assert not lan.is_private_ip("fc00::1")          # only fd00::/8 per the spec
    assert lan.classify_client("8.8.8.8") == "public" and lan.classify_client(None) == "unknown"
    assert lan.device_name_from_ua("") == "Device" and lan.device_name_from_ua("(Macintosh) Safari/605") == "Mac · Safari"


def test_default_state_does_not_listen_on_the_network(v2_state):
    from epoch import main
    state = main.AppState(config=v2_state.config, db_path=v2_state.db_path, aw=v2_state.aw)
    assert main.bind_host(state) == "127.0.0.1" and state.lan_active is False
    set_lan(v2_state.db_path)
    assert main.bind_host(state) == "0.0.0.0"
    set_lan(v2_state.db_path, False)
    from dataclasses import replace
    state.config = replace(v2_state.config, lan=True)
    assert main.bind_host(state) == "0.0.0.0"


def test_a_long_lived_stream_is_cut_off_when_the_device_is_revoked(owner, from_addr, v2_state):
    """The SSE connection re-checks its device every few seconds, so revoking is not just for new requests."""
    from types import SimpleNamespace
    from epoch.web import app as webapp

    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    cookie = "; ".join(f"{k}={v}" for k, v in device.cookies.items())
    request = SimpleNamespace(
        scope={"witness.role": "device"}, url=SimpleNamespace(path="/api/stream"),
        headers={"host": "192.168.1.23:8765", "cookie": cookie}, client=SimpleNamespace(host=TABLET),
    )
    assert webapp._stream_still_allowed(v2_state, request) is True
    device_id = owner.get("/api/devices").json()["devices"][0]["id"]
    owner.post(f"/api/devices/{device_id}/revoke")
    assert webapp._stream_still_allowed(v2_state, request) is False
    # the owner's own stream is never re-checked
    assert webapp._stream_still_allowed(v2_state, SimpleNamespace(scope={"witness.role": "owner"})) is True


def test_a_paired_device_can_only_upload_recent_cards_and_skylines(owner, from_addr, v2_state):
    from tests.test_uploads import PNG64
    from epoch import rules

    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    with db.get_conn(v2_state.db_path) as conn:
        today = rules.today_local(conn)
    old = (today - timedelta(days=60)).isoformat()
    ok = device.post("/api/postcards", json={"png_base64": PNG64, "kind": "day", "period": today.isoformat()})
    assert ok.status_code == 200, ok.text
    for body in ({"kind": "day", "period": old}, {"kind": "weekly", "period": old}):
        assert device.post("/api/postcards", json={"png_base64": PNG64, **body}).status_code == 403
    assert device.post("/api/skyline", json={"png_base64": PNG64, "day": old}).status_code == 403
    # the computer itself is not limited
    assert owner.post("/api/postcards", json={"png_base64": PNG64, "kind": "day", "period": old}).status_code == 200


# --------------------------------------------------------------------------
# The "epoch" host names (a hosts entry on the Mac, or mDNS); "underdog" still works for an old hosts entry
# --------------------------------------------------------------------------

@pytest.mark.parametrize("host", [
    "epoch", "epoch:8765", "epoch:9999", "epoch.local", "epoch.local:8765", "EPOCH:8765",
    "underdog", "underdog:8765", "underdog.local", "underdog.local:8765", "UNDERDOG:8765",
])
def test_epoch_host_names_work_on_the_mac_without_tablet_mode(from_addr, host):
    assert from_addr("127.0.0.1", host).get("/api/today").status_code == 200


@pytest.mark.parametrize("host", ["epoch:8765", "epoch.local:8765", "underdog:8765", "underdog.local:8765"])
def test_epoch_host_names_work_for_lan_clients_only_in_lan_mode(owner, from_addr, v2_state, host):
    assert from_addr("192.168.1.40", host).get("/api/today").status_code == 403       # tablet mode is off
    set_lan(v2_state.db_path)
    device, _ = pair(owner, from_addr)
    device.headers["host"] = host
    assert device.get("/api/today").status_code == 200


@pytest.mark.parametrize("host", [
    "epoch.evil.example", "epoch.local.evil.example", "evilepoch", "epoch.com:8765", "xepoch.local",
    "underdog.evil.example", "underdog.local.evil.example", "evilunderdog", "underdog.com:8765", "xunderdog.local",
])
def test_epoch_look_alike_hosts_are_refused(from_addr, v2_state, host):
    set_lan(v2_state.db_path)
    assert from_addr("127.0.0.1", host).get("/api/today").status_code == 400


def test_settings_lists_the_epoch_name_for_the_mac(owner):
    page = owner.get("/settings").text
    assert "http://epoch:8765" in page
    assert 'echo "127.0.0.1 epoch" | sudo tee -a /etc/hosts' in page
    assert "127.0.0.1 underdog" not in page
