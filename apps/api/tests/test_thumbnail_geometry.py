"""The poster frame is de-squeezed to square pixels and fitted inside 1280x1280, never enlarged."""
import shutil
import subprocess

import pytest

from packages.transcoder.ffmpeg_transcoder import THUMBNAIL_VF

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _thumbnail_size(tmp_path, source_size: str, sar: str) -> str:
    source = tmp_path / "src.mp4"
    thumb = tmp_path / "thumb.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=gray:s={source_size}:r=2:d=1",
         "-vf", f"setsar={sar}", "-pix_fmt", "yuv420p", str(source)],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-map", "0:V:0", "-vf", THUMBNAIL_VF,
         "-q:v", "2", "-frames:v", "1", str(thumb)],
        check=True, capture_output=True,
    )
    probed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(thumb)],
        check=True, capture_output=True, text=True,
    )
    return probed.stdout.strip()


@pytest.mark.parametrize(
    "source_size, sar, expected",
    [
        ("3840x2160", "1/1", "1280,720"),  # shrunk to the box
        ("320x240", "1/1", "320,240"),  # never enlarged
        ("1080x1920", "1/1", "720,1280"),  # portrait keeps its shape
        ("640x360", "2/1", "640,180"),  # wide pixels: shrink the height
        ("640x360", "1/2", "320,360"),  # narrow pixels: shrink the width
    ],
)
def test_thumbnail_size(tmp_path, source_size, sar, expected):
    assert _thumbnail_size(tmp_path, source_size, sar) == expected
