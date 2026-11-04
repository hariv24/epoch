"""macOS desktop notifications. Never raises; returns True only if one was sent."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

SUBPROCESS_TIMEOUT = 5  # seconds
# launchd starts programs with a minimal PATH, so Homebrew's folders are checked by hand too.
EXTRA_BIN_DIRS = ("/opt/homebrew/bin", "/usr/local/bin")


def escape_applescript(text: str) -> str:
    """Make text safe inside a double-quoted AppleScript string.

    Backslashes must be escaped first, otherwise the backslashes we add
    for the quotes would themselves get doubled.
    """
    return text.replace("\\", "\\\\").replace('"', '\\"')


def build_osascript_command(title: str, message: str) -> list[str]:
    """The osascript argument list (no shell is involved, so no shell quoting needed)."""
    script = (
        f'display notification "{escape_applescript(message)}" '
        f'with title "{escape_applescript(title)}"'
    )
    return ["osascript", "-e", script]


def build_terminal_notifier_command(
    executable: str, title: str, message: str, url: str | None
) -> list[str]:
    """The terminal-notifier argument list. `-open` makes the click open the url."""
    command = [executable, "-title", title, "-message", message or " "]
    if url:
        command += ["-open", url]
    return command


def find_terminal_notifier() -> str | None:
    """Path to terminal-notifier: on PATH, else in the usual Homebrew folders."""
    found = shutil.which("terminal-notifier")
    if found:
        return found
    for folder in EXTRA_BIN_DIRS:
        candidate = os.path.join(folder, "terminal-notifier")
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _run(command: list[str]) -> bool:
    """Run a command quietly; True if it exited with status 0."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            timeout=SUBPROCESS_TIMEOUT,
            check=False,
        )
    except Exception:
        return False
    return result.returncode == 0


def notify(title: str, message: str, url: str | None = None) -> bool:
    """Show a macOS notification. Returns False on other platforms or on any error."""
    try:
        if sys.platform != "darwin":
            return False
        executable = find_terminal_notifier()
        if executable:
            command = build_terminal_notifier_command(executable, title, message, url)
            if _run(command):
                return True
            # terminal-notifier failed (e.g. blocked); try the built-in route.
        return _run(build_osascript_command(title, message))
    except Exception:
        return False
