"""Reframe a landscape clip to vertical 9:16 (or other aspect).

Pick a horizontal crop center (0..1) that keeps the speaker framed. Primary detector
is OpenCV's YuNet DNN (cv2.FaceDetectorYN — modern, accurate, no protobuf/mediapipe
conflict); falls back to a Haar cascade, then to mid-frame. Sampled centers are
aggregated with a median to reject outliers (a stray detection won't yank the crop).
"""
from __future__ import annotations

import statistics
import threading
import urllib.request
from pathlib import Path

import cv2

import settings

ASPECTS = {
    "9:16": (9, 16),
    "1:1": (1, 1),
    "4:5": (4, 5),
}

_YUNET_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
              "face_detection_yunet/face_detection_yunet_2023mar.onnx")
_yunet_failed = False
# One detector PER THREAD. cv2.FaceDetectorYN keeps per-call state (setInputSize, then
# detect), and the export pool renders two clips at once: a shared instance let the two
# threads overwrite each other's input size mid-detection, so the same shot framed at 65%
# alone and 37% under load. Building one is cheap; the model file is read once from disk.
_yunet_local = threading.local()
_yunet_download_lock = threading.Lock()
_HAAR_XML = "haarcascade_frontalface_default.xml"
_haar_path = None
_haar_unavailable = False


def _yunet_model() -> Path:
    """The YuNet ONNX file, downloaded once. Atomic: a half-written file is never used."""
    model = settings.DATA_DIR / "models" / "face_detection_yunet_2023mar.onnx"
    with _yunet_download_lock:
        if not model.exists():
            model.parent.mkdir(parents=True, exist_ok=True)
            print("[reframe] downloading YuNet face model (one-time)...")
            part = model.with_suffix(".onnx.part")
            urllib.request.urlretrieve(_YUNET_URL, part)
            part.replace(model)
    return model


def _yunet_detector():
    """This thread's YuNet detector (created on first use), or None when YuNet is unavailable."""
    global _yunet_failed
    if _yunet_failed:
        return None
    det = getattr(_yunet_local, "det", None)
    if det is not None:
        return det
    try:
        det = cv2.FaceDetectorYN.create(str(_yunet_model()), "", (320, 320), 0.6, 0.3, 5000)
    except Exception as e:  # noqa: BLE001
        print(f"[reframe] YuNet unavailable ({e}); using Haar fallback")
        _yunet_failed = True
        return None
    _yunet_local.det = det
    return det


def _centers_yunet(frames: list) -> list[float]:
    det = _yunet_detector()
    if det is None:
        return []
    centers = []
    for frame in frames:
        h, w = frame.shape[:2]
        det.setInputSize((w, h))
        _, faces = det.detect(frame)
        if faces is not None and len(faces):
            # largest face by box area (faces[i] = [x, y, w, h, ...landmarks, score])
            best = max(faces, key=lambda f: f[2] * f[3])
            centers.append(min(1.0, max(0.0, (best[0] + best[2] / 2) / w)))
    return centers


def _haar_cascade():
    """A freshly loaded Haar face cascade, or None when this OpenCV build doesn't ship it.

    Headless / slim OpenCV wheels can be missing `cv2.data` or the XML itself, and an
    unloaded CascadeClassifier raises `!empty()` from detectMultiScale rather than just
    finding nothing — which used to abort the whole export. Check it up front instead.

    Only the *negative* answer is memoised: detectMultiScale mutates the classifier, so a
    shared instance isn't safe across the render pool's threads, and each caller gets its
    own. A build without the XML still parses nothing and warns once per process.
    """
    global _haar_path, _haar_unavailable
    if _haar_unavailable:
        return None
    try:
        if _haar_path is None:
            _haar_path = cv2.data.haarcascades + _HAAR_XML
        cascade = cv2.CascadeClassifier(_haar_path)
    except Exception as e:  # noqa: BLE001 - no cv2.data in this build
        print(f"[reframe] Haar cascade unavailable ({e}); centering the crop")
        _haar_unavailable = True
        return None
    if cascade.empty():
        print("[reframe] Haar cascade file missing; centering the crop")
        _haar_unavailable = True
        return None
    return cascade


def _centers_haar(frames: list, width: float) -> list[float]:
    cascade = _haar_cascade()
    if cascade is None:
        return []
    centers = []
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.2, 5, minSize=(60, 60))
        if len(faces):
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            centers.append((x + w / 2) / width)
    return centers


def detect_center(video_path: Path, start: float, end: float, samples: int = 12) -> float:
    """Return a robust horizontal crop center in 0..1 based on detected faces."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0.5
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1
    span = max(0.1, end - start)
    frames = []
    try:
        for i in range(samples):
            t = start + span * (i + 0.5) / samples
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if ok:
                frames.append(frame)
    finally:
        cap.release()
    if not frames:
        return 0.5
    # Framing is a nicety; the export is not. Any detector blowing up (missing model,
    # unsupported build, odd frame) falls back to a mid-frame crop instead of failing
    # the render the user is waiting on.
    try:
        centers = _centers_yunet(frames) or _centers_haar(frames, width)
    except Exception as e:  # noqa: BLE001
        print(f"[reframe] face detection failed ({e}); centering the crop")
        return 0.5
    if not centers:
        return 0.5
    return float(statistics.median(centers))  # outlier-robust


# --------------------------------------------------------------------------- #
# Shot-aware reframe
# --------------------------------------------------------------------------- #
# One crop position per clip is right for a single camera and wrong for anything edited:
# a talk or podcast that cuts from a wide shot to a close-up puts the speaker somewhere else
# after every cut, and a single median position leaves their face half off the frame. So the
# clip is split into shots at hard cuts, the face is found in each shot, and the crop moves
# ONLY at the cuts - never inside a shot, so nothing ever pans or jitters.
SHOT_STEP = 0.25            # seconds between sampled frames when looking for cuts
CUT_CORRELATION = 0.55      # HSV histogram correlation below this = a hard cut
MIN_SHOT = 0.75             # shorter "shots" are flashes; fold them into the previous one
SAME_CENTER = 0.05          # adjacent shots closer than this keep one position
MAX_SHOTS = 40              # cap the crop expression length on very busy edits
FACES_PER_SHOT = 5


def _hsv_hist(frame):
    small = cv2.resize(frame, (96, 54), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist


def detect_cuts(video_path: Path, start: float, end: float) -> list[float]:
    """Source times where a new shot begins inside [start, end]; always starts with `start`."""
    cuts = [float(start)]
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return cuts
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        stride = max(1, int(round(fps * SHOT_STEP)))
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
        prev, idx = None, 0
        while True:
            if not cap.grab():
                break
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if t > end:
                break
            if idx % stride == 0:
                ok, frame = cap.retrieve()
                if ok:
                    hist = _hsv_hist(frame)
                    if prev is not None and cv2.compareHist(prev, hist, cv2.HISTCMP_CORREL) < CUT_CORRELATION:
                        if t - cuts[-1] >= MIN_SHOT:
                            cuts.append(round(t, 3))
                    prev = hist
            idx += 1
    finally:
        cap.release()
    if len(cuts) > 1 and end - cuts[-1] < MIN_SHOT:
        cuts.pop()                      # a flash at the very end belongs to the last shot
    return cuts


def _frames_at(video_path: Path, times: list[float]) -> list:
    cap = cv2.VideoCapture(str(video_path))
    frames = []
    if not cap.isOpened():
        return frames
    try:
        for t in times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if ok:
                frames.append(frame)
    finally:
        cap.release()
    return frames


def _shot_center(video_path: Path, a: float, b: float) -> float | None:
    """Median face center inside one shot, or None when no face is visible in it."""
    n = FACES_PER_SHOT
    frames = _frames_at(video_path, [a + (b - a) * (i + 0.5) / n for i in range(n)])
    if not frames:
        return None
    try:
        width = frames[0].shape[1] or 1
        centers = _centers_yunet(frames) or _centers_haar(frames, width)
    except Exception as e:  # noqa: BLE001 - framing must never fail an export
        print(f"[reframe] face detection failed in a shot ({e})")
        return None
    return float(statistics.median(centers)) if centers else None


def detect_track(video_path: Path, start: float, end: float) -> dict:
    """{"start", "end", "shots": [{"start": source_t, "center": 0..1}, ...]} for a clip.

    A shot with no face (a slide, B-roll, a wide audience shot) is centered, which is what
    shows a slide whole. Neighbouring shots that would sit within SAME_CENTER of each other
    share one position. Never raises: any failure degrades to one centered shot."""
    try:
        cuts = detect_cuts(video_path, start, end)
    except Exception as e:  # noqa: BLE001
        print(f"[reframe] shot detection failed ({e}); using one shot")
        cuts = [float(start)]
    bounds = cuts + [float(end)]
    shots: list[dict] = []
    for a, b in zip(bounds, bounds[1:]):
        c = _shot_center(video_path, a, b)
        shots.append({"start": round(a, 3), "center": round(0.5 if c is None else c, 4)})
    merged: list[dict] = []
    for sh in shots:
        if merged and abs(sh["center"] - merged[-1]["center"]) < SAME_CENTER:
            continue
        merged.append(sh)
    while len(merged) > MAX_SHOTS:          # keep the busiest edits to a sane expression
        i = min(range(1, len(merged)), key=lambda k: abs(merged[k]["center"] - merged[k - 1]["center"]))
        merged.pop(i)
    return {"start": round(float(start), 3), "end": round(float(end), 3),
            "shots": merged or [{"start": round(float(start), 3), "center": 0.5}]}


def track_center_at(track: dict | None, t: float, default: float = 0.5) -> float:
    shots = (track or {}).get("shots") or []
    center = shots[0]["center"] if shots else default
    for sh in shots:
        if t >= sh["start"] - 1e-6:
            center = sh["center"]
        else:
            break
    return float(center)


def track_median(track: dict | None) -> float:
    """Duration-weighted center of a track - what a single static crop would use."""
    shots = (track or {}).get("shots") or []
    if not shots:
        return 0.5
    end = float(track.get("end", shots[-1]["start"]))
    weighted = []
    for i, sh in enumerate(shots):
        nxt = shots[i + 1]["start"] if i + 1 < len(shots) else end
        weighted.append((sh["center"], max(0.0, nxt - sh["start"])))
    total = sum(w for _, w in weighted) or 1.0
    return round(sum(c * w for c, w in weighted) / total, 4)


def track_covers(track: dict | None, start: float, end: float) -> bool:
    return bool(track) and track.get("start", 1e9) <= start + 0.05 and track.get("end", -1) >= end - 0.05


def track_x_expr(track: dict, src_w: int, crop_w: int, times: list[float]) -> str:
    """A piecewise-constant ffmpeg crop `x` expression in OUTPUT time.

    `times` are the output-timeline start of each shot (already shifted to clip-local time,
    and remapped across any cuts by the caller); shot i's position applies from times[i]."""
    max_x = max(0, src_w - crop_w)
    xs = [max(0, min(max_x, int(round(sh["center"] * src_w - crop_w / 2)))) for sh in track["shots"]]
    expr = str(xs[-1])
    for t, x in zip(reversed(times[1:]), reversed(xs[:-1])):
        expr = f"if(lt(t,{t:.3f}),{x},{expr})"
    return expr


def crop_filter(src_w: int, src_h: int, aspect: str, center: float,
                out_w: int, out_h: int, x_expr: str | None = None) -> str:
    """Build an ffmpeg -vf crop+scale chain producing out_w x out_h.

    `x_expr` (from track_x_expr) replaces the fixed x with a per-shot one; crop evaluates
    x for every frame, so the window moves exactly at each cut."""
    aw, ah = ASPECTS.get(aspect, (9, 16))
    target_ratio = aw / ah

    if src_w / src_h > target_ratio:
        # source too wide -> crop width
        crop_h = src_h
        crop_w = int(round(crop_h * target_ratio))
    else:
        # source too tall -> crop height
        crop_w = src_w
        crop_h = int(round(crop_w / target_ratio))

    crop_w = min(crop_w, src_w)
    crop_h = min(crop_h, src_h)
    max_x = src_w - crop_w
    x = int(round(center * src_w - crop_w / 2))
    x = max(0, min(max_x, x))
    y = (src_h - crop_h) // 2
    x_part = f"'{x_expr}'" if x_expr else str(x)
    return f"crop={crop_w}:{crop_h}:{x_part}:{y},scale={out_w}:{out_h}:flags=lanczos"


def crop_width(src_w: int, src_h: int, aspect: str) -> int:
    """The crop window's width for this source and aspect (same rule as crop_filter)."""
    aw, ah = ASPECTS.get(aspect, (9, 16))
    target_ratio = aw / ah
    w = int(round(src_h * target_ratio)) if src_w / src_h > target_ratio else src_w
    return min(w, src_w)


def probe_fps(video_path: Path) -> str:
    """The source's frame rate as an ffmpeg rational ("24/1", "30000/1001").

    avg_frame_rate first: for variable-frame-rate phone footage it is the rate that keeps the
    total duration right, which is what a re-timing filter (zoompan) has to preserve. Falls
    back to r_frame_rate, then to 30/1, so a probe failure can never fail a render."""
    import subprocess
    for key in ("avg_frame_rate", "r_frame_rate"):
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", f"stream={key}", "-of", "csv=p=0", str(video_path)],
                capture_output=True, text=True, timeout=30).stdout.strip()
            num, _, den = out.partition("/")
            if float(num) > 0 and float(den or 1) > 0:
                return f"{int(num)}/{int(den or 1)}"
        except Exception:  # noqa: BLE001 - try the next field, then the default
            continue
    return "30/1"


def probe_size(video_path: Path) -> tuple[int, int]:
    cap = cv2.VideoCapture(str(video_path))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
    cap.release()
    return w, h
