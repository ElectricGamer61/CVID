"""The Windows launchers must hand the cookie-browser setting to the backend process.

Two halves:
  * source checks - every launcher that starts uvicorn resolves the setting through
    scripts\\cvideo-env.ps1 and passes it on. These run everywhere.
  * live checks - the real scripts\\cvideo-env.ps1 executed by a real PowerShell, ending
    in a child process that prints the variable it received. These are the regression for
    the Windows report ("the preference was set, the backend never saw it") and are
    SKIPPED with a printed reason when no PowerShell is reachable (Linux CI, macOS).
Nothing here writes to the real user environment: the registry test uses a key of its own
under HKCU:\\Software\\Cvideo and deletes it again.
"""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import settings  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
HELPER = SCRIPTS / "cvideo-env.ps1"
VAR = "CVIDEO_YOUTUBE_COOKIE_BROWSERS"
# start.ps1 and open-cvideo.ps1 hand the backend to a SEPARATE powershell window, so they
# must also inject the value into that window's command string. serve.ps1 runs uvicorn in
# its own process, which inherits it.
LAUNCHERS = {"serve.ps1": False, "start.ps1": True, "open-cvideo.ps1": True}

failed = []
skipped = []
def check(name, ok):
    print(("  ok   " if ok else "  FAIL ") + name)
    if not ok: failed.append(name)


# --------------------------------------------------------------------------- #
# Source checks
# --------------------------------------------------------------------------- #
def test_every_launcher_resolves_and_passes_the_setting():
    for name, needs_prefix in LAUNCHERS.items():
        text = (SCRIPTS / name).read_text(encoding="utf-8")
        check(f"{name} loads the shared resolver", "cvideo-env.ps1" in text)
        check(f"{name} resolves the setting into the backend environment",
              "Initialize-CvideoBackendEnv" in text)
        check(f"{name} records the decision for support logs",
              "Get-CvideoCookieSummary" in text and "Add-Content $log" in text)
        if needs_prefix:
            check(f"{name} injects the setting into the backend window's command",
                  "Get-CvideoBackendEnvPrefix" in text and "$backendEnv" in text)


def test_helper_agrees_with_the_backend():
    text = HELPER.read_text(encoding="utf-8")
    check("the launcher default matches the backend default",
          f'$CvideoCookieDefault   = "{",".join(settings.DEFAULT_COOKIE_BROWSERS)}"' in text)
    for browser in settings.SUPPORTED_COOKIE_BROWSERS:
        if f'"{browser}"' not in text:
            check(f"launcher knows the supported browser {browser}", False)
            break
    else:
        check("launcher and backend accept the same browsers", True)
    check("the helper is ASCII-only (PowerShell 5.1 parses it)",
          all(ord(ch) < 128 for ch in text))


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
        local = Path(tempfile.mkdtemp(prefix="cvideo-launcher-"))
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
    local = Path(tempfile.mkdtemp(prefix="cvideo-launcher-", dir=local_temp))
    return local, win_temp.rstrip("\\") + "\\" + local.name


def _run_ps(ps: str, local_dir: Path, win_dir: str, body: str) -> subprocess.CompletedProcess:
    script = local_dir / "check.ps1"
    script.write_text(body, encoding="ascii")
    return subprocess.run([ps, "-ExecutionPolicy", "Bypass", "-NoProfile", "-File",
                           win_dir + "\\check.ps1"], capture_output=True, text=True, timeout=300)


def test_live_powershell():
    ps = _powershell()
    if not ps:
        skipped.append("live PowerShell checks (no powershell/pwsh on this machine)")
        return
    space = _workspace(ps)
    if not space:
        skipped.append("live PowerShell checks (no shared Windows temp directory)")
        return
    local, win = space
    (local / "scripts").mkdir()
    shutil.copy(HELPER, local / "scripts" / HELPER.name)
    (local / "backend").mkdir()

    # 1. The resolver, on real PowerShell, against the backend's own resolver.
    cases = [("$null", None), ('"firefox,chrome"', "firefox,chrome"), ('"off"', "off"),
             ('""', ""), ('"netscape,edge"', "netscape,edge"), ('"auto"', "auto")]
    body = ['. "$PSScriptRoot\\scripts\\cvideo-env.ps1"']
    for literal, _ in cases:
        body.append("(Resolve-CvideoCookieBrowsers -ProcessValue $null -UserValue %s "
                    "-MachineValue $null -EnvFileValue $null).Value" % literal)
    out = _run_ps(ps, local, win, "\n".join(body) + "\n")
    lines = [line.strip() for line in out.stdout.replace("\r", "").split("\n")]
    lines = [line for line in lines if line != ""] if out.returncode == 0 else []
    values = []
    index = 0
    for _literal, raw in cases:                     # blank output lines are dropped above
        expected = ",".join(settings.resolve_cookie_browsers(raw, windows=True))
        got = lines[index] if expected and index < len(lines) else ""
        if expected:
            index += 1
        values.append((raw, expected, got))
    check("PowerShell resolver ran", out.returncode == 0)
    check("launcher resolution matches the backend for every input",
          all(expected == got for _raw, expected, got in values))
    if any(expected != got for _raw, expected, got in values):
        print("        " + repr(values) + " stderr=" + out.stderr[-400:])

    # 2. The actual regression: a value living in the WINDOWS USER ENVIRONMENT (registry),
    #    invisible to this already-running shell, must still reach the backend CHILD process.
    key = "HKCU:\\Software\\Cvideo\\LauncherTest"
    body = f'''. "$PSScriptRoot\\scripts\\cvideo-env.ps1"
$key = "{key}"
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name "{VAR}" -Value "firefox,chrome" -PropertyType String -Force | Out-Null
try {{
  # Simulate the reported machine: the setting exists in the user environment, but this
  # shell was started before it was set, so its own environment block does not have it.
  [Environment]::SetEnvironmentVariable("{VAR}", $null, 'Process')
  $resolved = Initialize-CvideoBackendEnv -Root $PSScriptRoot -UserEnvPath $key
  "resolved=" + $resolved.Value
  "source=" + $resolved.Source
  $prefix = Get-CvideoBackendEnvPrefix
  # Backtick-escaped so `$env: stays literal for the CHILD instead of expanding here.
  $childCmd = $prefix + "Set-Content -LiteralPath '$PSScriptRoot\\child.txt' -Value ('child=' + `$env:{VAR})"
  Start-Process powershell -ArgumentList @("-NoProfile", "-Command", $childCmd) -Wait -WindowStyle Hidden
  Get-Content -LiteralPath "$PSScriptRoot\\child.txt"
}} finally {{
  Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
}}
'''
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("a user-environment value set after login is still found",
          "resolved=firefox,chrome" in text and "user environment" in text)
    check("the backend child process receives the setting", "child=firefox,chrome" in text)
    if "child=firefox,chrome" not in text:
        print("        stdout=" + text[-500:] + " stderr=" + out.stderr[-400:])

    # 3. Nothing configured anywhere: the child must still get the Windows default order.
    body = f'''. "$PSScriptRoot\\scripts\\cvideo-env.ps1"
$key = "HKCU:\\Software\\Cvideo\\LauncherTestEmpty"
Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
New-Item -Path $key -Force | Out-Null
try {{
  [Environment]::SetEnvironmentVariable("{VAR}", $null, 'Process')
  $resolved = Initialize-CvideoBackendEnv -Root $PSScriptRoot -UserEnvPath $key -MachineEnvPath $key
  "resolved=" + $resolved.Value
  $childCmd = (Get-CvideoBackendEnvPrefix) + "Set-Content -LiteralPath '$PSScriptRoot\\child2.txt' -Value ('child=' + `$env:{VAR})"
  Start-Process powershell -ArgumentList @("-NoProfile", "-Command", $childCmd) -Wait -WindowStyle Hidden
  Get-Content -LiteralPath "$PSScriptRoot\\child2.txt"
  Get-CvideoCookieSummary $resolved
}} finally {{
  Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
}}
'''
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    default = ",".join(settings.DEFAULT_COOKIE_BROWSERS)
    check("an unconfigured Windows machine defaults to chrome, edge, firefox",
          f"resolved={default}" in text and f"child={default}" in text)
    check("the summary line states where the cookies go",
          "sent only to YouTube" in text)
    if f"child={default}" not in text:
        print("        stdout=" + text[-500:] + " stderr=" + out.stderr[-400:])

    # 4. backend\.env still works, and an explicit off is honoured end to end.
    (local / "backend" / ".env").write_text(f"{VAR}=off\n", encoding="ascii")
    body = f'''. "$PSScriptRoot\\scripts\\cvideo-env.ps1"
$key = "HKCU:\\Software\\Cvideo\\LauncherTestOff"
Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
New-Item -Path $key -Force | Out-Null
try {{
  [Environment]::SetEnvironmentVariable("{VAR}", $null, 'Process')
  $resolved = Initialize-CvideoBackendEnv -Root $PSScriptRoot -UserEnvPath $key -MachineEnvPath $key
  "value=[" + $resolved.Value + "] source=" + $resolved.Source
  Get-CvideoCookieSummary $resolved
}} finally {{
  Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
}}
'''
    out = _run_ps(ps, local, win, body)
    text = out.stdout.replace("\r", "")
    check("an explicit off in backend\\.env is honoured by the launcher",
          "value=[] source=backend\\.env" in text and "fallback: OFF" in text)
    shutil.rmtree(local, ignore_errors=True)


if __name__ == "__main__":
    test_every_launcher_resolves_and_passes_the_setting()
    test_helper_agrees_with_the_backend()
    test_live_powershell()
    for reason in skipped:
        print("  skip " + reason)
    print("\n" + ("ALL PASSED" if not failed else f"{len(failed)} FAILED: {failed}"))
    raise SystemExit(bool(failed))
