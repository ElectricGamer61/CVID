"""Everything Studio derives from a clip with ffmpeg: probe, speech audio, loudness, proxy."""
from __future__ import annotations

import json
import subprocess
import wave
from fractions import Fraction
from pathlib import Path
from typing import Callable

import numpy as np

FRAME_S = 0.01            # loudness resolution: one value per 10 ms
DB_FLOOR = -100.0         # energy.bin stores round(dB) + 100, clamped to 0..100


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        tail = " ".join((r.stderr or "").strip().splitlines()[-3:])
        raise RuntimeError(f"{Path(cmd[0]).name} failed: {tail or r.returncode}")
    return r


def probe(path: Path) -> dict:
    """Duration, displayed size, frame rate, sound and recording time of one clip."""
    r = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format",
              "-show_streams", str(path)])
    info = json.loads(r.stdout)
    fmt = info.get("format", {})
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None and audio is None:
        raise RuntimeError("this file has no video or audio Studio can read")

    duration = float(fmt.get("duration") or (video or audio or {}).get("duration") or 0)
    out = {"duration": round(duration, 3), "has_audio": audio is not None, "width": 0,
           "height": 0, "fps": "", "vfr": False, "recorded_at": "", "is_audio_only": video is None}
    if video is not None:
        w, h = int(video.get("width") or 0), int(video.get("height") or 0)
        rot = 0
        for sd in video.get("side_data_list") or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        rot = rot or int(float((video.get("tags") or {}).get("rotate") or 0))
        if abs(rot) % 180 == 90:          # ffmpeg auto-rotates on decode; so must we
            w, h = h, w
        avg, real = video.get("avg_frame_rate") or "0/0", video.get("r_frame_rate") or "0/0"
        out.update(width=w, height=h, fps=_clean_rate(avg) or _clean_rate(real))
        fa, fr = _rate(avg), _rate(real)
        # Phones record variable frame rate: the nominal rate and the average disagree.
        out["vfr"] = bool(fa and fr and abs(fa - fr) / fr > 0.01)
    tags = {**(fmt.get("tags") or {}), **((video or {}).get("tags") or {})}
    out["recorded_at"] = (tags.get("creation_time") or tags.get("com.apple.quicktime.creationdate")
                          or "")
    return out


def _rate(r: str) -> float:
    try:
        f = Fraction(r)
        return float(f) if f > 0 else 0.0
    except (ValueError, ZeroDivisionError):
        return 0.0


def _clean_rate(r: str) -> str:
    """A tidy rational: 2997/100 -> 30000/1001-style values are kept, junk becomes ''."""
    f = _rate(r)
    if not f or f > 240:
        return ""
    for std in (Fraction(24000, 1001), Fraction(30000, 1001), Fraction(60000, 1001)):
        if abs(f - float(std)) < 0.005:
            return f"{std.numerator}/{std.denominator}"
    return str(Fraction(r).limit_denominator(1001)) if "/" in r else r


def extract_speech_audio(src: Path, dst: Path) -> None:
    """16 kHz mono PCM: what every speech engine wants, and what loudness is measured on."""
    tmp = dst.with_suffix(".tmp.wav")
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
          "-c:a", "pcm_s16le", str(tmp)])
    tmp.replace(dst)


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        sr, n, width = w.getframerate(), w.getnframes(), w.getsampwidth()
        if width != 2:
            raise RuntimeError("expected 16-bit PCM")
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    return a, sr


def loudness(samples: np.ndarray, sr: int) -> np.ndarray:
    """dB per 10 ms frame."""
    hop = int(sr * FRAME_S)
    n = len(samples) // hop
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    frames = samples[: n * hop].reshape(n, hop)
    rms = np.sqrt((frames.astype(np.float64) ** 2).mean(axis=1))
    return (20 * np.log10(rms + 1e-5)).astype(np.float32)


def write_energy(wav: Path, dst: Path) -> None:
    samples, sr = read_wav(wav)
    db = loudness(samples, sr)
    dst.write_bytes(np.clip(np.round(db - DB_FLOOR), 0, 100).astype(np.uint8).tobytes())


def read_energy(path: Path) -> np.ndarray:
    return np.frombuffer(path.read_bytes(), dtype=np.uint8).astype(np.float32) + DB_FLOOR


def seconds_of_sound(energy_db: np.ndarray, level_db: float = -40.0) -> float:
    """How much of a clip is louder than a quiet room. Speech sits well above -40 dBFS;
    silent B-roll (often an all-zero track) and camera hiss sit far below it."""
    return float((energy_db > level_db).sum()) * FRAME_S


def write_thumb(src: Path, dst: Path, duration: float) -> None:
    # A tenth of the way in (at most 8 s): past the fade-in or black lead-in most videos open
    # with, which made the first-second thumbnail of a real talk a black rectangle.
    t = min(max(1.0, duration * 0.1), 8.0, duration / 2) if duration else 0
    _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1",
          "-vf", "scale=320:-2", "-q:v", "4", str(dst)])


def make_proxy(src: Path, dst: Path, info: dict, progress: Callable[[float], None] | None = None) -> None:
    """A 720p H.264 copy with a keyframe every half second, so scrubbing and the seamless
    preview player can land on any point instantly. Constant frame rate even when the
    original isn't, so preview timing matches the export."""
    tmp = dst.with_suffix(".tmp.mp4")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
    if info.get("is_audio_only"):
        cmd += ["-vn"]                     # a voiceover or podcast: the <video> just plays sound
    else:
        fps = info.get("fps") or "30"
        gop = max(1, round((_rate(fps) or 30.0) / 2))
        vf = (f"scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)',"
              f"fps={fps},format=yuv420p")
        cmd += ["-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0"]
    cmd += (["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"] if info.get("has_audio")
            else ["-an"])
    cmd += ["-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(tmp)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace")
    dur = info.get("duration") or 0
    assert proc.stdout is not None
    for line in proc.stdout:
        if progress and dur and line.startswith("out_time_us="):
            try:
                progress(min(1.0, int(line.split("=", 1)[1]) / 1e6 / dur))
            except ValueError:
                pass
    err = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError("proxy failed: " + " ".join(err.strip().splitlines()[-3:]))
    tmp.replace(dst)
