"""The Windows launchers must UPDATE the install before they start the backend.

The regression this pins: a fix can be merged and still not be running. The laptop's YouTube
ingest kept failing after the fix for it was merged because the Desktop icon starts uvicorn
out of backend\\.venv against whatever commit install.cmd last checked out - nothing pulls,
and nothing re-runs `pip install -r requirements-bare.txt`, so a bumped yt-dlp pin never
reaches the venv that downloads the video.

Two halves, same shape as test_launcher_env.py:
  * source checks - every launcher loads scripts\\cvideo-update.ps1 and runs it before the
    backend starts; setup-laptop.ps1 stamps the venv it just built. These run everywhere.
  * live checks - the real helper executed by a real PowerShell against a throwaway git
    repo and a fake venv in the temp directory: a stale stamp triggers the re-sync, a
    current one does not, a behind-by-one checkout is fast-forwarded, and a dirty working
    tree is left alone. SKIPPED with a printed reason where no PowerShell exists.
Nothing here touches the real checkout, the real venv, or the real user environment.
"""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
HELPER = SCRIPTS / "cvideo-update.ps1"
# Launchers that start a backend must update first. start.ps1 runs the Vite dev server, so
# it re-syncs the venv but never rebuilds dist; the other two serve the built UI.
LAUNCHERS = {"serve.ps1": True, "open-cvideo.ps1": True, "start.ps1": False}

failed = []
skipped = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


# --------------------------------------------------------------------------- #
# Source checks
# --------------------------------------------------------------------------- #
def test_every_launcher_updates_before_starting_the_backend():
    for name, serves_dist in LAUNCHERS.items():
        text = (SCRIPTS / name).read_text(encoding="utf-8")
        check(f"{name} loads the shared updater", "cvideo-update.ps1" in text)
        check(f"{name} re-syncs the venv to the pinned requirements",
              "Update-CvideoInstall" in text or "Sync-CvideoBackendDeps" in text)
        check(f"{name} records what it did for support logs", "Add-Content $log" in text)
        if serves_dist:
            # It serves frontend\dist, so an update that moved the UI has to rebuild it -
            # otherwise a pull leaves new backend code behind the old screens.
            check(f"{name} rebuilds the UI after an update", "Update-CvideoInstall" in text)
        # The backend must start even when the update could not run (offline, no git).
        check(f"{name} does not gate the backend on the update succeeding",
              "exit 1" not in text.split("cvideo-update.ps1")[1].split("Start-Process")[0]
              or "dist\\index.html" in text)


def test_setup_stamps_the_venv_it_built():
    text = (SCRIPTS / "setup-laptop.ps1").read_text(encoding="utf-8")
    check("setup-laptop.ps1 stamps the venv after installing",
          "Write-CvideoDepsStamp" in text)
    check("the stamp is written after pip, not before",
          text.index("requirements-bare.txt") < text.index("Write-CvideoDepsStamp"))


def test_manual_update_entry_point_exists():
    cmd = (ROOT / "update.cmd")
    check("update.cmd exists for a one-double-click update", cmd.is_file())
    if cmd.is_file():
        check("update.cmd runs scripts\\update.ps1", "update.ps1" in cmd.read_text(encoding="utf-8"))
    text = (SCRIPTS / "update.ps1").read_text(encoding="utf-8")
    check("a manual update forces the dependency re-sync", "-Force" in text)


def test_helper_is_parseable_ascii():
    text = HELPER.read_text(encoding="utf-8")
    check("the updater is ASCII-only (PowerShell 5.1 parses it)",
          all(ord(ch) < 128 for ch in text))
    check("the auto-update opt-out is documented in the file", "CVIDEO_AUTO_UPDATE" in text)


# --------------------------------------------------------------------------- #
# Live checks (real PowerShell)
# --------------------------------------------------------------------------- #
def _powershell() -> str | None:
    for candidate in ("pwsh", "powershell.exe", "powershell",
                      "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"):
        found = shutil.which(candidate)
        if found:
            return found
        if os.path.exists(candidate):
            return candidate
    return None


def _workspace(ps: str) -> tuple[Path, str] | None:
    """A directory this process can write and PowerShell can address (WSL-safe)."""
    if os.name == "nt":
        local = Path(tempfile.mkdtemp(prefix="cvideo-update-"))
        return local, str(local)
    try:
        win_temp = subprocess.run([ps, "-NoProfile", "-Command", "[IO.Path]::GetTempPath()"],
                                  capture_output=True, text=True, timeout=120).stdout.strip()
        local_temp = subprocess.run(["wslpath", "-u", win_temp],
                                    capture_output=True, text=True, timeout=60).stdout.strip()
    except Exception:  # noqa: BLE001 - no PowerShell/wslpath means "skip", never "fail"
        return None
    if not win_temp or not local_temp or not Path(local_temp).is_dir():
        return None
    local = Path(tempfile.mkdtemp(prefix="cvideo-update-", dir=local_temp))
    return local, win_temp.rstrip("\\") + "\\" + local.name


def _run_ps(ps: str, local_dir: Path, win_dir: str, body: str) -> subprocess.CompletedProcess:
    script = local_dir / "check.ps1"
    script.write_text(body, encoding="ascii")
    return subprocess.run([ps, "-ExecutionPolicy", "Bypass", "-NoProfile", "-File",
                           win_dir + "\\check.ps1"], capture_output=True, text=True, timeout=600)


def _fake_install(local: Path) -> None:
    """A checkout shaped like Cvideo, with a venv whose python is a stub, not a real one."""
    (local / "scripts").mkdir(exist_ok=True)
    shutil.copy(HELPER, local / "scripts" / HELPER.name)
    (local / "backend").mkdir(exist_ok=True)
    (local / "backend" / "requirements-bare.txt").write_text("yt-dlp==2026.7.4\n", encoding="ascii")
    scripts_dir = local / "backend" / ".venv" / "Scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    # A .cmd named python.exe would not be executed by PowerShell's & operator, so record the
    # call from a real batch file the helper can invoke by full path instead.
    (scripts_dir / "python.exe").write_text("", encoding="ascii")


def test_live_dependency_sync():
    ps = _powershell()
    if not ps:
        skipped.append("live PowerShell checks (no powershell/pwsh on this machine)")
        return
    space = _workspace(ps)
    if not space:
        skipped.append("live PowerShell checks (no shared Windows temp directory)")
        return
    local, win = space
    _fake_install(local)
    stamp = local / "backend" / ".venv" / ".cvideo-deps.stamp"

    # 1. No stamp at all (every machine installed before this change) => a re-sync is due.
    body = f'''. "{win}\\scripts\\cvideo-update.ps1"
$hash = Get-CvideoRequirementsHash -Root "{win}"
"hash=" + $hash
"stamp-exists=" + (Test-Path "{win}\\backend\\.venv\\.cvideo-deps.stamp")
Write-CvideoDepsStamp -Root "{win}"
"stamped=" + (Get-Content "{win}\\backend\\.venv\\.cvideo-deps.stamp" -Raw).Trim()
'''
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    hash_line = next((l.split("=", 1)[1] for l in text.split("\n") if l.startswith("hash=")), "")
    check("the helper hashes the requirements file", len(hash_line) == 64)
    check("an install made before this change has no stamp", "stamp-exists=False" in text)
    check("the stamp records the requirements hash", f"stamped={hash_line}" in text)

    # 2. A matching stamp must NOT run pip (this is what keeps every launch fast).
    body = f'''. "{win}\\scripts\\cvideo-update.ps1"
Sync-CvideoBackendDeps -Root "{win}"
'''
    out = _run_ps(ps, local, win, body)
    check("a current stamp skips the re-sync",
          "up to date" in out.stdout.replace("\r", ""))

    # 3. Change the pins the way a merged fix does: the very next launch must re-sync.
    (local / "backend" / "requirements-bare.txt").write_text("yt-dlp==2026.8.1\n", encoding="ascii")
    stale_hash = stamp.read_text(encoding="ascii").strip()
    body = f'''. "{win}\\scripts\\cvideo-update.ps1"
"stale=" + ((Get-CvideoRequirementsHash -Root "{win}") -ne "{stale_hash}")
Sync-CvideoBackendDeps -Root "{win}"
'''
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("a bumped pin is detected as stale", "stale=True" in text)
    # The stub python.exe cannot install anything; what matters is that the helper TRIED and
    # then reported the failure instead of throwing, and left the stale stamp in place so the
    # next launch tries again rather than pretending the venv is current.
    check("a failed re-sync is reported, not fatal", "Backend dependencies:" in text)
    check("a failed re-sync does not stamp the venv",
          stamp.read_text(encoding="ascii").strip() == stale_hash)

    shutil.rmtree(local, ignore_errors=True)


def test_live_checkout_update():
    ps = _powershell()
    if not ps or not shutil.which("git"):
        skipped.append("live checkout checks (no PowerShell or no git)")
        return
    space = _workspace(ps)
    if not space:
        skipped.append("live checkout checks (no shared Windows temp directory)")
        return
    local, win = space

    def git(repo: Path, *args: str) -> None:
        subprocess.run(["git", "-C", str(repo), *args], check=True,
                       capture_output=True, text=True, timeout=120)

    # An "upstream" and a clone of it, one commit behind - exactly the laptop's situation.
    upstream = local / "upstream"
    upstream.mkdir()
    git(upstream, "init", "--quiet", "--initial-branch=main")
    git(upstream, "config", "user.email", "test@example.com")
    git(upstream, "config", "user.name", "Cvideo Test")
    (upstream / "README.md").write_text("v1\n", encoding="ascii")
    _fake_install(upstream)          # the helper and a stub venv ship with the checkout
    git(upstream, "add", "-A")
    git(upstream, "commit", "--quiet", "-m", "one")
    clone = local / "clone"
    subprocess.run(["git", "clone", "--quiet", str(upstream), str(clone)],
                   check=True, capture_output=True, text=True, timeout=300)
    git(clone, "config", "user.email", "test@example.com")
    git(clone, "config", "user.name", "Cvideo Test")
    # The clone was made by this (Linux) git, so origin points at /mnt/c/... - a path the
    # Windows git the launcher actually runs cannot open. Re-point it at the same directory
    # spelled the Windows way.
    git(clone, "remote", "set-url", "origin", win + "\\upstream")
    (upstream / "frontend").mkdir()
    (upstream / "frontend" / "app.txt").write_text("new ui\n", encoding="ascii")
    git(upstream, "add", "-A")
    git(upstream, "commit", "--quiet", "-m", "two")
    win_clone = win + "\\clone"

    body = f'''. "{win_clone}\\scripts\\cvideo-update.ps1"
$r = Update-CvideoCheckout -Root "{win_clone}"
"updated=" + $r.Updated
"changed=" + ($r.Changed -join ",")
"message=" + $r.Message
'''
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("a checkout behind its upstream is fast-forwarded", "updated=True" in text)
    check("the changed paths come back so the UI can be rebuilt",
          "changed=frontend/app.txt" in text)
    check("the pulled commit is really in the working tree",
          (clone / "frontend" / "app.txt").is_file())

    # Already current: no pull, and it says so rather than staying silent.
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("an up-to-date checkout is left alone", "updated=False" in text and "up to date" in text)

    # A working tree with local edits belongs to a human; the launcher must not touch it.
    (upstream / "README.md").write_text("v3\n", encoding="ascii")
    git(upstream, "add", "-A")
    git(upstream, "commit", "--quiet", "-m", "three")
    (clone / "README.md").write_text("my local edit\n", encoding="ascii")
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("a dirty working tree is never auto-updated",
          "updated=False" in text and "local changes" in text)
    check("the local edit survives", "my local edit" in (clone / "README.md").read_text())

    # The opt-out has to work, or a dev checkout cannot be kept where it is.
    (clone / "README.md").write_text("v1\n", encoding="ascii")
    git(clone, "checkout", "--quiet", "--", "README.md")
    body_off = f'''$env:CVIDEO_AUTO_UPDATE = "off"
. "{win_clone}\\scripts\\cvideo-update.ps1"
$r = Update-CvideoCheckout -Root "{win_clone}"
"updated=" + $r.Updated
"message=" + $r.Message
'''
    out = _run_ps(ps, local, win, body_off)
    text = out.stdout.replace("\r", "")
    check("CVIDEO_AUTO_UPDATE=off stops the pull", "updated=False" in text and "is off" in text)

    shutil.rmtree(local, ignore_errors=True)


def test_every_launcher_keeps_ytdlp_current():
    """The pin regression, pinned.

    Sync-CvideoBackendDeps only runs pip when requirements-bare.txt CHANGES, and that file
    pinned `yt-dlp==2026.7.4`. So the "self-updating" install could never move yt-dlp at all:
    the stamp matched, pip never ran, and the one dependency that goes stale on its own -
    YouTube rewrites its player every few weeks - was the one guaranteed to rot. Every
    launcher must therefore run the separate yt-dlp refresh too."""
    for name in LAUNCHERS:
        text = (SCRIPTS / name).read_text(encoding="utf-8")
        check(f"{name} refreshes yt-dlp on its own cadence",
              "Sync-CvideoYtDlp" in text or "Update-CvideoInstall" in text)
    update = (SCRIPTS / "update.ps1").read_text(encoding="utf-8")
    check("update.cmd forces a yt-dlp refresh",
          "Sync-CvideoYtDlp" in update and "-Force" in update)
    for req in ("requirements-bare.txt", "requirements-lean.txt", "requirements.txt"):
        text = (ROOT / "backend" / req).read_text(encoding="utf-8")
        check(f"{req} does not pin yt-dlp to an exact version", "yt-dlp==" not in text)
        check(f"{req} installs the JS-challenge extras", "yt-dlp[default,deno]" in text)


def test_live_ytdlp_refresh():
    """The refresh is time-gated, not hash-gated, and -Force overrides both gates."""
    ps = _powershell()
    if not ps:
        skipped.append("live yt-dlp refresh checks (no powershell/pwsh on this machine)")
        return
    space = _workspace(ps)
    if not space:
        skipped.append("live yt-dlp refresh checks (no shared Windows temp directory)")
        return
    local, win = space
    _fake_install(local)
    stamp = local / "backend" / ".venv" / ".cvideo-ytdlp.stamp"

    # A fresh stamp means "checked recently" - a launcher must NOT run pip on every start.
    stamp.write_text("2026-08-20T00:00:00", encoding="ascii")
    helper = win + chr(92) + "scripts" + chr(92) + "cvideo-update.ps1"
    body = "\n".join([
        '. "' + helper + '"',
        '"recent=" + (Sync-CvideoYtDlp -Root "' + win + '")',
        '$env:CVIDEO_YTDLP_MAX_AGE_HOURS = "0"',
        '"always=" + (Sync-CvideoYtDlp -Root "' + win + '")',
        '$env:CVIDEO_YTDLP_MAX_AGE_HOURS = $null',
        '$env:CVIDEO_AUTO_UPDATE = "off"',
        '"off=" + (Sync-CvideoYtDlp -Root "' + win + '")',
        '"forced=" + (Sync-CvideoYtDlp -Root "' + win + '" -Force)',
        '',
    ])
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("a recently checked install does not re-run pip",
          "recent=YouTube downloader: checked recently" in text)
    # The fake venv's python.exe is an empty file, so pip cannot actually succeed here; what
    # is under test is that the gate OPENED, not that the download worked.
    check("CVIDEO_YTDLP_MAX_AGE_HOURS=0 checks on every start",
          "always=YouTube downloader: checked recently" not in text)
    check("CVIDEO_AUTO_UPDATE=off stops the yt-dlp refresh too",
          "off=YouTube downloader: skipped" in text)
    check("-Force overrides both the age gate and the off switch",
          "forced=YouTube downloader: skipped" not in text)

    shutil.rmtree(local, ignore_errors=True)


if __name__ == "__main__":
    test_every_launcher_updates_before_starting_the_backend()
    test_every_launcher_keeps_ytdlp_current()
    test_setup_stamps_the_venv_it_built()
    test_manual_update_entry_point_exists()
    test_helper_is_parseable_ascii()
    test_live_dependency_sync()
    test_live_checkout_update()
    test_live_ytdlp_refresh()
    for reason in skipped:
        print("  skip " + reason)
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
