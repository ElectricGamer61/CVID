# Optional: install CrisperWhisper 2.0, Studio's best speech engine. It writes down every
# um, stutter and cut-off word, with the most precise word timing in the 2026-11-06
# bake-off (data\bakeoff), which is what the Cut room needs to find and cut them.
#
# It needs PyTorch, which Cvideo's own venv deliberately never installs, so it gets a venv
# of its own at data\engines\crisper. Studio finds it there by itself (or set
# CVIDEO_CRISPER_PYTHON to another Python that has it). Without it Studio uses ElevenLabs
# Scribe (with a key) or Parakeet (free, CPU).
#
# Size: about 3 GB of PyTorch now, about 3 GB of model weights on the first transcription.
# LICENCE: the CrisperWhisper weights are non-commercial (nyra-health licence). Fine for
# your own videos; not for a build you sell.
#
# ASCII-only for PS 5.1. Native tools are called directly (no 2>&1): under PS 5.1 with
# "Stop", merging a native command's stderr turns every pip notice into a fatal error.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$venv = Join-Path $root "data\engines\crisper"
$py = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Host "Creating the CrisperWhisper environment (Python 3.11)..." -ForegroundColor Cyan
  & py -3.11 -m venv $venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $py)) {
    throw "Python 3.11 is needed (the 'py -3.11' launcher). Install it, then run this again."
  }
}
& $py -m pip install --upgrade pip --quiet

$gpu = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
$index = "https://download.pytorch.org/whl/cpu"
if ($gpu) {
  # cu128 is the first CUDA build with Blackwell (RTX 50xx, sm_120) kernels.
  $index = "https://download.pytorch.org/whl/cu128"
  Write-Host "NVIDIA GPU found: installing PyTorch for CUDA 12.8 (about 3 GB)..." -ForegroundColor Cyan
} else {
  Write-Host "No NVIDIA GPU: installing PyTorch for the CPU (transcription will be slower)..." -ForegroundColor Cyan
}
& $py -m pip install torch torchaudio --index-url $index
if ($LASTEXITCODE -ne 0) { throw "PyTorch did not install (see above)." }

Write-Host "Installing CrisperWhisper..." -ForegroundColor Cyan
& $py -m pip install "crisperwhisper[transformers]==2.0.4" soundfile
if ($LASTEXITCODE -ne 0) { throw "CrisperWhisper did not install (see above)." }

& $py -c "import torch, crisperwhisper; print('CrisperWhisper is ready. Using the GPU:', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw "CrisperWhisper installed but does not load (see above)." }
Write-Host "Done. Restart Cvideo; Studio now writes its transcripts with CrisperWhisper." -ForegroundColor Green
