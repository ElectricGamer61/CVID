"""Unit tests for the 9:16 reframe math and its face-detection fallbacks.

Standalone like the other backend test scripts — no server, no ffmpeg, no test asset:

    cd backend && .venv/Scripts/python.exe test_reframe.py     # Windows
    cd backend && .venv/bin/python test_reframe.py             # WSL/Linux
"""
from __future__ import annotations

import sys
import traceback
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.pipeline import reframe  # noqa: E402

FAKE_VIDEO = Path("clip.mp4")   # never opened - _fake_capture stubs cv2.VideoCapture


@contextmanager
def patched(**attrs):
    """Temporarily swap attributes on the reframe module."""
    old = {k: getattr(reframe, k) for k in attrs}
    for k, v in attrs.items():
        setattr(reframe, k, v)
    try:
        yield
    finally:
        for k, v in old.items():
            setattr(reframe, k, v)


def _fake_capture(_path):
    """A cv2.VideoCapture that always hands back a 1920-wide readable frame."""
    class _Cap:
        def isOpened(self): return True
        def get(self, _prop): return 1920.0
        def set(self, *_a): return True
        def read(self): return True, object()
        def release(self): return None
    return _Cap()


def _boom(*_a, **_kw):
    raise RuntimeError("detector exploded")


# ---------------------------------------------------------------- crop_filter

def test_crop_filter_wide_source_crops_width():
    f = reframe.crop_filter(1920, 1080, "9:16", 0.5, 1080, 1920)
    # a 1080-tall source at 9:16 -> a 608px-wide window, centered
    assert f == "crop=608:1080:656:0,scale=1080:1920:flags=lanczos", f


def test_crop_filter_clamps_the_center_to_the_frame():
    left = reframe.crop_filter(1920, 1080, "9:16", 0.0, 1080, 1920)
    right = reframe.crop_filter(1920, 1080, "9:16", 1.0, 1080, 1920)
    assert left.startswith("crop=608:1080:0:0"), left        # never a negative x
    assert right.startswith("crop=608:1080:1312:0"), right   # never past src_w - crop_w


def test_crop_filter_tall_source_crops_height():
    f = reframe.crop_filter(1080, 1920, "1:1", 0.5, 1080, 1080)
    assert f.startswith("crop=1080:1080:0:420"), f


def test_crop_filter_unknown_aspect_falls_back_to_9_16():
    assert (reframe.crop_filter(1920, 1080, "bogus", 0.5, 1080, 1920)
            == reframe.crop_filter(1920, 1080, "9:16", 0.5, 1080, 1920))


# --------------------------------------------------------- detector fallbacks
# Framing is a nicety; the export is not. An OpenCV build without the Haar XML used
# to raise `!empty()` out of detectMultiScale and kill the export mid-render, so every
# detector failure has to land on a centered crop instead.

def test_haar_returns_nothing_when_the_cascade_is_unavailable():
    with patched(_haar_cascade=lambda: None):
        assert reframe._centers_haar([object()], 1920) == []


def test_haar_cascade_is_none_when_the_xml_is_missing():
    # The headless wheel has cv2.data but ships no XML, so the classifier loads empty.
    with fresh_cascade(empty=True):
        assert reframe._haar_cascade() is None


def test_haar_cascade_is_none_when_the_build_has_no_cascade_data():
    with fresh_cascade(empty=False, with_data=False):
        assert reframe._haar_cascade() is None


def test_a_missing_haar_cascade_is_only_looked_up_once():
    loads = []
    with fresh_cascade(empty=True, loads=loads):
        assert reframe._haar_cascade() is None
        assert reframe._haar_cascade() is None
    assert len(loads) == 1, loads   # the failure is remembered, not re-warned per clip


def test_a_working_haar_cascade_is_never_shared_between_calls():
    # detectMultiScale mutates the classifier, and two renders run at once in the pool —
    # so a usable cascade must be built per call, not memoised into one shared instance.
    loads = []
    with fresh_cascade(empty=False, loads=loads):
        first, second = reframe._haar_cascade(), reframe._haar_cascade()
    assert first is not None and second is not None
    assert first is not second, "the cascade must not be shared across threads"
    assert len(loads) == 2, loads


def test_detect_center_is_centered_when_detection_raises():
    with patched(cv2=_Cv2Stub(), _centers_yunet=_boom, _centers_haar=_boom):
        assert reframe.detect_center(FAKE_VIDEO, 0.0, 1.0) == 0.5


def test_detect_center_is_centered_when_nothing_is_detected():
    with patched(cv2=_Cv2Stub(), _centers_yunet=lambda f: [],
                 _centers_haar=lambda f, w: []):
        assert reframe.detect_center(FAKE_VIDEO, 0.0, 1.0) == 0.5


def test_detect_center_medians_the_samples():
    with patched(cv2=_Cv2Stub(), _centers_yunet=lambda f: [0.2, 0.3, 0.99]):
        assert reframe.detect_center(FAKE_VIDEO, 0.0, 1.0) == 0.3   # outlier rejected


def test_detect_center_is_centered_when_the_file_will_not_open():
    class _Closed:
        def isOpened(self): return False
        def release(self): return None
    with patched(cv2=_Cv2Stub(capture=lambda _p: _Closed())):
        assert reframe.detect_center(FAKE_VIDEO, 0.0, 1.0) == 0.5


class _CascadeStub:
    """A CascadeClassifier that reports whether it managed to load."""

    def __init__(self, empty: bool):
        self._empty = empty

    def empty(self):
        return self._empty


class _Cv2NoDataStub:
    """A build with no `cv2.data` at all — reading it raises AttributeError."""

    def __init__(self, empty, loads):
        self._empty = empty
        self._loads = loads

    def CascadeClassifier(self, path):   # noqa: N802 - mirrors the cv2 name
        self._loads.append(path)
        return _CascadeStub(empty=self._empty)   # a fresh one per call, as cv2 does


class _Cv2CascadeStub(_Cv2NoDataStub):
    """The same, plus the `cv2.data.haarcascades` path the slim wheel does expose."""

    class data:                     # noqa: N801 - mirrors the cv2 submodule name
        haarcascades = "/no/such/dir/"


@contextmanager
def fresh_cascade(empty: bool, with_data: bool = True, loads: list | None = None):
    """Run with an empty cascade memo and a stubbed cv2, so cases can't leak into each other."""
    stub_cls = _Cv2CascadeStub if with_data else _Cv2NoDataStub
    with patched(cv2=stub_cls(empty, loads if loads is not None else []),
                 _haar_path=None, _haar_unavailable=False):
        yield


class _Cv2Stub:
    """Just the handful of cv2 names detect_center touches."""
    CAP_PROP_FRAME_WIDTH = 3
    CAP_PROP_POS_MSEC = 0

    def __init__(self, capture=_fake_capture):
        self._capture = capture

    def VideoCapture(self, path):   # noqa: N802 - mirrors the cv2 name
        return self._capture(path)


def main() -> int:
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ok   {name}")
        except Exception:  # noqa: BLE001
            failures += 1
            print(f"  FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
