# Cvideo backend environment resolution - shared by every Windows launcher.
# Dot-source it:  . "$PSScriptRoot\cvideo-env.ps1"
# ASCII-only on purpose: em-dash / ellipsis chars break PowerShell 5.1 parsing.
#
# WHY THIS FILE EXISTS
# A value in the Windows USER environment (HKCU\Environment - what `setx` and the System
# Properties dialog write) does NOT reach a process that was already running when it was
# set: every process gets the environment block its parent captured, and Explorer captured
# yours at login. So a user who set CVIDEO_YOUTUBE_COOKIE_BROWSERS and then double-clicked
# a launcher from the same Explorer session started a backend that never saw it, and the
# job failed with "No browser-cookie fallback is enabled" while the setting was plainly
# there in the environment dialog. The launchers now read the setting from the registry
# (and backend\.env) themselves and hand it to the backend process explicitly.
#
# PRIVACY: this only decides WHICH browser yt-dlp may read cookies from, on this PC. The
# cookies go to the YouTube request Cvideo is already making and nowhere else.

$CvideoCookieVar       = "CVIDEO_YOUTUBE_COOKIE_BROWSERS"
# Windows default: try the signed-in browsers people actually have, in this order.
$CvideoCookieDefault   = "chrome,edge,firefox"
# The browsers yt-dlp can read a cookie store from (keep in sync with backend\settings.py).
$CvideoCookieSupported = @("brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale")
# Explicit "do not touch my browsers" values. An empty value means the same thing.
$CvideoCookieDisabled  = @("off", "none", "no", "0", "false", "disabled")
# Explicit "just use the default order" values.
$CvideoCookieAuto      = @("auto", "default", "on", "yes", "1", "true")
$CvideoMachineEnvKey   = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"

function Get-CvideoRegistryEnv {
  # Read a variable straight out of the registry, so a value set AFTER this shell started
  # (or after login) is still found. Returns $null when the value does not exist.
  param([string]$Name, [string]$Path = "HKCU:\Environment")
  try {
    $key = Get-Item -LiteralPath $Path -ErrorAction Stop
    # DoNotExpandEnvironmentNames: keep REG_EXPAND_SZ text verbatim; we only ever store
    # a plain browser list here and expanding would be a needless surprise.
    return $key.GetValue($Name, $null, 'DoNotExpandEnvironmentNames')
  } catch {
    return $null
  }
}

function Get-CvideoEnvFileValue {
  # Read KEY=value out of backend\.env (the file the backend itself loads). Returns $null
  # when the file or the key is absent; returns "" for a key that is present but blank.
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $pattern = "^\s*(?:export\s+)?{0}\s*=(.*)$" -f [Regex]::Escape($Name)
  $value = $null
  foreach ($line in (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)) {
    if ($line -match "^\s*#") { continue }
    if ($line -match $pattern) { $value = $Matches[1].Trim().Trim('"').Trim("'") }   # last one wins, like dotenv
  }
  return $value
}

function Resolve-CvideoCookieBrowsers {
  # Pure decision function (no registry, no files) so it can be tested directly.
  # Precedence: this process > user registry > machine registry > backend\.env > default.
  # Returns Value (comma list, "" = disabled), Source, and Dropped (unsupported names).
  # NOTE: [object], not [string] - PowerShell coerces a $null argument to "" for a
  # [string] parameter, which would erase the difference between "not configured"
  # (use the default) and "configured empty" (the user turned the fallback off).
  param(
    [object]$ProcessValue,
    [object]$UserValue,
    [object]$MachineValue,
    [object]$EnvFileValue
  )
  $raw = $null; $source = "default (Windows)"
  foreach ($candidate in @(
      @{ Value = $ProcessValue;  Source = "this window's environment" },
      @{ Value = $UserValue;     Source = "Windows user environment" },
      @{ Value = $MachineValue;  Source = "Windows system environment" },
      @{ Value = $EnvFileValue;  Source = "backend\.env" })) {
    if ($null -ne $candidate.Value) { $raw = $candidate.Value; $source = $candidate.Source; break }
  }
  if ($null -eq $raw) { $raw = $CvideoCookieDefault }

  $text = ([string]$raw).Trim().ToLowerInvariant()
  if ($text -eq "" -or $CvideoCookieDisabled -contains $text) {
    return [PSCustomObject]@{ Value = ""; Source = $source; Dropped = @(); Disabled = $true }
  }
  if ($CvideoCookieAuto -contains $text) { $text = $CvideoCookieDefault }

  $kept = @(); $dropped = @()
  foreach ($name in $text.Split(",")) {
    $name = $name.Trim()
    if ($name -eq "") { continue }
    if ($CvideoCookieSupported -contains $name) {
      if ($kept -notcontains $name) { $kept += $name }
    } elseif ($dropped -notcontains $name) {
      $dropped += $name
    }
  }
  return [PSCustomObject]@{ Value = ($kept -join ","); Source = $source; Dropped = $dropped; Disabled = $false }
}

function Initialize-CvideoBackendEnv {
  # Resolve the setting and put it in THIS process's environment, so every child the
  # launcher starts (uvicorn directly, or a supervised powershell) inherits the same
  # answer instead of whatever stale block Explorer happened to hand us.
  # The two registry paths are parameters only so a test can point them at a key of its
  # own instead of writing to the real user environment.
  param(
    [string]$Root,
    [string]$UserEnvPath = "HKCU:\Environment",
    [string]$MachineEnvPath = $CvideoMachineEnvKey
  )
  $resolved = Resolve-CvideoCookieBrowsers `
    -ProcessValue  ([Environment]::GetEnvironmentVariable($CvideoCookieVar, 'Process')) `
    -UserValue     (Get-CvideoRegistryEnv -Name $CvideoCookieVar -Path $UserEnvPath) `
    -MachineValue  (Get-CvideoRegistryEnv -Name $CvideoCookieVar -Path $MachineEnvPath) `
    -EnvFileValue  (Get-CvideoEnvFileValue -Path (Join-Path $Root "backend\.env") -Name $CvideoCookieVar)
  [Environment]::SetEnvironmentVariable($CvideoCookieVar, $resolved.Value, 'Process')
  return $resolved
}

function Get-CvideoBackendEnvPrefix {
  # PowerShell statements that re-assert the resolved settings inside a child window's
  # -Command string. Inheritance already covers this; being explicit means a child that
  # starts with a fresh environment for any reason still agrees with the launcher.
  $value = [Environment]::GetEnvironmentVariable($CvideoCookieVar, 'Process')
  if ($null -eq $value) { $value = "" }
  return ("`$env:{0}='{1}'; " -f $CvideoCookieVar, $value.Replace("'", "''"))
}

function Get-CvideoCookieSummary {
  # One ASCII line for the console and data\backend.log - the evidence a support log needs.
  param($Resolved)
  if ($Resolved.Disabled -or $Resolved.Value -eq "") {
    $line = "YouTube browser-cookie fallback: OFF (from {0})." -f $Resolved.Source
  } else {
    $line = "YouTube browser-cookie fallback: {0} (from {1}). Cookies stay on this PC and are sent only to YouTube." -f `
      ($Resolved.Value -replace ",", ", "), $Resolved.Source
  }
  if ($Resolved.Dropped.Count -gt 0) {
    $line += " Ignored unsupported browser(s): {0}. Supported: {1}." -f `
      ($Resolved.Dropped -join ", "), ($CvideoCookieSupported -join ", ")
  }
  return $line
}
