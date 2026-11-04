"""notify() tests. subprocess and platform are faked; nothing is ever shown."""
from __future__ import annotations

import subprocess

from epoch import notify as notify_module


class FakeRun:
    """Records subprocess.run calls and returns a canned exit code."""

    def __init__(self, returncodes=(0,), raises=None):
        self.calls: list[list[str]] = []
        self.returncodes = list(returncodes)
        self.raises = raises

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        if self.raises:
            raise self.raises
        code = self.returncodes.pop(0) if len(self.returncodes) > 1 else self.returncodes[0]
        return subprocess.CompletedProcess(command, code)


def setup(monkeypatch, platform="darwin", terminal_notifier=None, run=None):
    monkeypatch.setattr(notify_module.sys, "platform", platform)
    monkeypatch.setattr(notify_module.shutil, "which", lambda name: terminal_notifier)
    monkeypatch.setattr(notify_module, "EXTRA_BIN_DIRS", ())
    run = run or FakeRun()
    monkeypatch.setattr(notify_module.subprocess, "run", run)
    return run


def test_escape_applescript_handles_backslashes_before_quotes():
    assert notify_module.escape_applescript('say "hi"') == 'say \\"hi\\"'
    assert notify_module.escape_applescript("a\\b") == "a\\\\b"
    # A backslash directly before a quote must not unescape the quote.
    assert notify_module.escape_applescript('\\"') == '\\\\\\"'


def test_not_macos_returns_false_without_running(monkeypatch):
    run = setup(monkeypatch, platform="linux")
    assert notify_module.notify("t", "m") is False
    assert run.calls == []


def test_osascript_used_when_no_terminal_notifier(monkeypatch):
    run = setup(monkeypatch)
    assert notify_module.notify('He said "go"', "Block\\end") is True
    command = run.calls[0]
    assert command[:2] == ["osascript", "-e"]
    assert command[2] == 'display notification "Block\\\\end" with title "He said \\"go\\""'


def test_terminal_notifier_with_open_url(monkeypatch):
    run = setup(monkeypatch, terminal_notifier="/opt/homebrew/bin/terminal-notifier")
    assert notify_module.notify("Epoch", "Pick tonight's blocks", "http://127.0.0.1:8765/plan") is True
    assert run.calls == [
        [
            "/opt/homebrew/bin/terminal-notifier",
            "-title", "Epoch",
            "-message", "Pick tonight's blocks",
            "-open", "http://127.0.0.1:8765/plan",
        ]
    ]


def test_terminal_notifier_without_url_has_no_open_flag(monkeypatch):
    run = setup(monkeypatch, terminal_notifier="/x/terminal-notifier")
    notify_module.notify("T", "M")
    assert "-open" not in run.calls[0]


def test_falls_back_to_osascript_when_terminal_notifier_fails(monkeypatch):
    run = setup(monkeypatch, terminal_notifier="/x/terminal-notifier", run=FakeRun(returncodes=(1, 0)))
    assert notify_module.notify("T", "M") is True
    assert run.calls[0][0] == "/x/terminal-notifier"
    assert run.calls[1][0] == "osascript"


def test_nonzero_exit_returns_false(monkeypatch):
    setup(monkeypatch, run=FakeRun(returncodes=(1,)))
    assert notify_module.notify("T", "M") is False


def test_exceptions_never_escape(monkeypatch):
    setup(monkeypatch, run=FakeRun(raises=FileNotFoundError("no osascript")))
    assert notify_module.notify("T", "M") is False
    setup(monkeypatch, run=FakeRun(raises=subprocess.TimeoutExpired("osascript", 5)))
    assert notify_module.notify("T", "M") is False


def test_terminal_notifier_is_found_in_homebrew_when_path_is_minimal(monkeypatch, tmp_path):
    """launchd starts Epoch with a minimal PATH, so Homebrew's folder is checked by hand."""
    fake = tmp_path / "terminal-notifier"
    fake.write_text("#!/bin/sh\n")
    fake.chmod(0o755)
    run = setup(monkeypatch, terminal_notifier=None)
    monkeypatch.setattr(notify_module, "EXTRA_BIN_DIRS", (str(tmp_path),))
    assert notify_module.notify("Title", "Body", "http://127.0.0.1:8765/plan") is True
    assert run.calls[0][0] == str(fake) and "-open" in run.calls[0]
