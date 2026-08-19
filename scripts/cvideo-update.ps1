# Cvideo self-update - shared by every Windows launcher.
# Dot-source it:  . "$PSScriptRoot\cvideo-update.ps1"
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.
#
# WHY THIS FILE EXISTS
# A fix that is merged is not a fix that is installed. The laptop sat on a YouTube ingest
# failure for hours after the fix for it was merged, because NOTHING on the normal path
# updates the machine: the Desktop icon runs open-cvideo.ps1, which starts uvicorn out of
# backend\.venv against whatever commit was checked out the day install.cmd last ran. Two
# separate things went stale and each is enough to break YouTube on its own:
#   1. the CHECKOUT   - the merged fix was never pulled;
#   2. the DEPENDENCIES - `pip install -r requirements-bare.txt` only ever runs inside
#      install.cmd, so a bumped yt-dlp pin never reaches the venv. yt-dlp is the extreme
#      case: YouTube's extractor breaks on the order of weeks, and the laptop was running
#      a yt-dlp a year old, which is exactly when YouTube starts answering with a bot
#      challenge instead of a video.
# So the launchers now fast-forward the checkout and re-sync the venv before starting the
# backend. Both steps are best-effort: an offline laptop, a dirty working tree or a missing
# git all just leave the app as it is and start it.
#
# Set CVIDEO_AUTO_UPDATE=off to keep a machine exactly where it is (a dev checkout, say).

$CvideoAutoUpdateVar = "CVIDEO_AUTO_UPDATE"
$CvideoAutoUpdateOff = @("off", "no", "0", "false", "never", "disabled")

function Test-CvideoAutoUpdateEnabled {
  $value = [Environment]::GetEnvironmentVariable($CvideoAutoUpdateVar, 'Process')
  if ($null -eq $value) { return $true }
  return -not ($CvideoAutoUpdateOff -contains ([string]$value).Trim().ToLowerInvariant())
}

function Invoke-CvideoGit {
  # git, with no chance of blocking the launcher on a credential prompt: an install whose
  # stored GitHub credential expired must fail in a second, not hang a double-click forever.
  param([string]$Root, [string[]]$GitArgs)
  # Continue, and stderr thrown away: git chatters on stderr even when it succeeds, and under
  # the launchers' $ErrorActionPreference = "Stop" every one of those lines is a TERMINATING
  # NativeCommandError - the same trap that once killed the backend on uvicorn's first INFO
  # line (see serve.ps1). The exit code is the only success signal used here.
  $ErrorActionPreference = "Continue"
  $old = $env:GIT_TERMINAL_PROMPT
  $env:GIT_TERMINAL_PROMPT = "0"
  try {
    $out = & git @("-C", $Root) @GitArgs 2>$null
    return [PSCustomObject]@{ Ok = ($LASTEXITCODE -eq 0); Output = ($out | Out-String).Trim() }
  } catch {
    return [PSCustomObject]@{ Ok = $false; Output = $_.Exception.Message }
  } finally {
    $env:GIT_TERMINAL_PROMPT = $old
  }
}

function Update-CvideoCheckout {
  # Fast-forward the checkout to its upstream. Deliberately conservative: a working tree with
  # local changes, a detached HEAD or a branch with no upstream is somebody's dev checkout and
  # is left alone. Returns Updated / Changed (paths that moved) / Message.
  param([string]$Root)
  $result = [PSCustomObject]@{ Updated = $false; Changed = @(); Message = "" }
  if (-not (Test-CvideoAutoUpdateEnabled)) {
    $result.Message = "Update check: skipped ($CvideoAutoUpdateVar is off)."
    return $result
  }
  if (-not (Test-Path (Join-Path $Root ".git"))) {
    $result.Message = "Update check: not a git checkout - skipped."
    return $result
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $result.Message = "Update check: git is not installed - skipped."
    return $result
  }
  $dirty = Invoke-CvideoGit -Root $Root -GitArgs @("status", "--porcelain")
  if (-not $dirty.Ok) {
    $result.Message = "Update check: git could not read this checkout - skipped."
    return $result
  }
  if ($dirty.Output -ne "") {
    $result.Message = "Update check: local changes present - left alone (commit or stash to auto-update)."
    return $result
  }
  $before = (Invoke-CvideoGit -Root $Root -GitArgs @("rev-parse", "HEAD")).Output
  $upstream = Invoke-CvideoGit -Root $Root -GitArgs @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
  if (-not $upstream.Ok) {
    $result.Message = "Update check: this branch tracks nothing - skipped."
    return $result
  }
  $fetch = Invoke-CvideoGit -Root $Root -GitArgs @("fetch", "--quiet")
  if (-not $fetch.Ok) {
    $result.Message = "Update check: could not reach GitHub - continuing with the installed version."
    return $result
  }
  $behind = (Invoke-CvideoGit -Root $Root -GitArgs @("rev-list", "--count", "HEAD..@{u}")).Output
  if ($behind -eq "0" -or $behind -eq "") {
    $result.Message = "Update check: Cvideo is up to date."
    return $result
  }
  # --ff-only, never a merge: an update that cannot be a fast-forward is a situation for a
  # human, not something a launcher should resolve on its way to starting a video editor.
  $pull = Invoke-CvideoGit -Root $Root -GitArgs @("merge", "--ff-only", "@{u}")
  if (-not $pull.Ok) {
    $result.Message = "Update check: {0} new commit(s) available but not a fast-forward - run update.cmd." -f $behind
    return $result
  }
  $after = (Invoke-CvideoGit -Root $Root -GitArgs @("rev-parse", "HEAD")).Output
  $diff = Invoke-CvideoGit -Root $Root -GitArgs @("diff", "--name-only", $before, $after)
  $result.Updated = $true
  $result.Changed = @($diff.Output -split "`r?`n" | Where-Object { $_ -ne "" })
  $result.Message = "Update: pulled {0} new commit(s) ({1} -> {2})." -f $behind, $before.Substring(0, 7), $after.Substring(0, 7)
  return $result
}

function Get-CvideoDepsStampPath {
  param([string]$Root)
  return (Join-Path $Root "backend\.venv\.cvideo-deps.stamp")
}

function Get-CvideoRequirementsHash {
  # Hash of the requirements file the install actually uses, so "did the pins change?" is a
  # question the launcher can answer in milliseconds without running pip.
  param([string]$Root)
  $req = Join-Path $Root "backend\requirements-bare.txt"
  if (-not (Test-Path -LiteralPath $req)) { return $null }
  return (Get-FileHash -LiteralPath $req -Algorithm SHA256).Hash
}

function Write-CvideoDepsStamp {
  # Called by setup-laptop.ps1 after its own pip install, so a fresh install does not make
  # the next launch repeat the work it just did.
  param([string]$Root)
  $hash = Get-CvideoRequirementsHash -Root $Root
  if ($null -eq $hash) { return }
  $stamp = Get-CvideoDepsStampPath -Root $Root
  $dir = Split-Path $stamp -Parent
  if (Test-Path -LiteralPath $dir) { Set-Content -LiteralPath $stamp -Value $hash -Encoding ASCII }
}

function Sync-CvideoBackendDeps {
  # Bring backend\.venv in line with requirements-bare.txt whenever the pins have changed
  # since the last successful install. Returns one ASCII line for the console and the log.
  # Best-effort by design: an offline machine keeps the packages it already has.
  param([string]$Root, [string]$Log, [switch]$Force)
  $ErrorActionPreference = "Continue"   # pip and python both write to stderr; see Invoke-CvideoGit.
  $py  = Join-Path $Root "backend\.venv\Scripts\python.exe"
  $req = Join-Path $Root "backend\requirements-bare.txt"
  if (-not (Test-Path -LiteralPath $py))  { return "Backend dependencies: no venv yet - run install.cmd." }
  if (-not (Test-Path -LiteralPath $req)) { return "Backend dependencies: requirements-bare.txt is missing - skipped." }
  $want  = Get-CvideoRequirementsHash -Root $Root
  $stamp = Get-CvideoDepsStampPath -Root $Root
  $have  = ""
  if (Test-Path -LiteralPath $stamp) { $have = (Get-Content -LiteralPath $stamp -Raw).Trim() }
  if ((-not $Force) -and $have -eq $want) { return "Backend dependencies: up to date." }

  Write-Host "Updating the backend downloader and dependencies (one time after an update)..." -ForegroundColor Cyan
  # cmd does the stderr merge: uvicorn's lesson applies to pip too - PowerShell's own "2>&1"
  # on a native command turns every stderr line into a terminating NativeCommandError.
  $pip = '"{0}" -m pip install --disable-pip-version-check -r "{1}" 2>&1' -f $py, $req
  if ($Log) { cmd /c $pip | Tee-Object -FilePath $Log -Append | Out-Null }
  else      { cmd /c $pip | Out-Null }
  if ($LASTEXITCODE -ne 0) {
    return "Backend dependencies: update failed (exit $LASTEXITCODE) - starting with the packages already installed. See the log above."
  }
  Set-Content -LiteralPath $stamp -Value $want -Encoding ASCII
  $version = (& $py -c "import yt_dlp, sys; sys.stdout.write(yt_dlp.version.__version__)" 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $version) { $version = "unknown" }
  return "Backend dependencies: updated to the pinned set (yt-dlp $version)."
}

function Sync-CvideoUi {
  # Rebuild frontend\dist when the UI sources moved (or it was never built). serve.ps1 and
  # open-cvideo.ps1 only build when dist is MISSING, so without this an update would start
  # new backend code behind the old screens.
  param([string]$Root, [string[]]$Changed = @(), [switch]$Force)
  $ErrorActionPreference = "Continue"   # npm writes to stderr; see Invoke-CvideoGit.
  $dist = Join-Path $Root "frontend\dist\index.html"
  $needs = $Force -or (-not (Test-Path -LiteralPath $dist)) -or
           (@($Changed | Where-Object { $_ -like "frontend/*" }).Count -gt 0)
  if (-not $needs) { return "UI: unchanged." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return "UI: npm not found - skipped." }
  Write-Host "Rebuilding the app UI..." -ForegroundColor Cyan
  Push-Location (Join-Path $Root "frontend")
  try {
    if (-not (Test-Path "node_modules")) { cmd /c "npm install 2>&1" | Out-Null }
    cmd /c "npm run build 2>&1" | Out-Null
    if ($LASTEXITCODE -ne 0) { return "UI: rebuild failed - the previously built UI is still being served." }
  } finally { Pop-Location }
  return "UI: rebuilt."
}

function Update-CvideoInstall {
  # The whole update in one call: pull, re-sync the venv, rebuild the UI if it moved.
  # Every launcher runs this before it starts a backend; update.cmd runs it on its own.
  param([string]$Root, [string]$Log)
  $lines = @()
  $checkout = Update-CvideoCheckout -Root $Root
  $lines += $checkout.Message
  $lines += (Sync-CvideoBackendDeps -Root $Root -Log $Log)
  $lines += (Sync-CvideoUi -Root $Root -Changed $checkout.Changed)
  return $lines
}
