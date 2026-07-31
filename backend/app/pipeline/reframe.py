"""Reframe a landscape clip to vertical 9:16 (or other aspect).

Pick a horizontal crop center (0..1) that keeps the speaker framed. Primary detector
is OpenCV's YuNet DNN (cv2.FaceDetectorYN — modern, accurate, no protobuf/mediapipe
conflict); falls back to a Haar cascade, then to mid-frame. Sampled centers are
aggregated with a median to reject outliers (a stray detection won't yank the crop).
"""
from __future__ import annotations

import statistics
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
_yunet = None
_yunet_failed = False


def _yunet_detector():
    """Lazy singleton YuNet detector; downloads the small ONNX model once. None on failure."""
    global _yunet, _yunet_failed
    if _yunet is not None or _yunet_failed:
        return _yunet
    try:
        model = settings.DATA_DIR / "models" / "face_detection_yunet_2023mar.onnx"
        model.parent.mkdir(parents=True, exist_ok=True)
        if not model.exists():
            print("[reframe] downloading YuNet face model (one-time)…")
            urllib.request.urlretrieve(_YUNET_URL, model)
        _yunet = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.6, 0.3, 5000)
    except Exception as e:  # noqa: BLE001
        print(f"[reframe] YuNet unavailable ({e}); using Haar fallback")
        _yunet_failed = True
    return _yunet


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
    """The Haar face cascade, or None when this OpenCV build doesn't ship it.

    Headless / slim OpenCV wheels can be missing `cv2.data` or the XML itself, and an
    unloaded CascadeClassifier raises `!empty()` from detectMultiScale rather than just
    finding nothing — which used to abort the whole export. Check it up front instead.
    """
    try:
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
    except Exception as e:  # noqa: BLE001 - no cv2.data in this build
        print(f"[reframe] Haar cascade unavailable ({e}); centering the crop")
        return None
    if cascade.empty():
        print("[reframe] Haar cascade file missing; centering the crop")
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


def crop_filter(src_w: int, src_h: int, aspect: str, center: float,
                out_w: int, out_h: int) -> str:
    """Build an ffmpeg -vf crop+scale chain producing out_w x out_h."""
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
    return f"crop={crop_w}:{crop_h}:{x}:{y},scale={out_w}:{out_h}:flags=lanczos"


def probe_size(video_path: Path) -> tuple[int, int]:
    cap = cv2.VideoCapture(str(video_path))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
    cap.release()
    return w, h
