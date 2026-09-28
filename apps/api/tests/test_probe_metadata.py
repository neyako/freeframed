"""parse_probe_metadata (#124): fps fraction handling, 0/0 guard, duration fallback.
plan_renditions: short-edge ladder that keeps vertical video sharp."""
from packages.transcoder.ffmpeg_transcoder import has_audio_stream, is_rotated_90, parse_probe_metadata, plan_renditions

QUALITIES = ["1080p", "720p", "360p"]


def test_fractional_ntsc_rate():
    meta = parse_probe_metadata({
        "streams": [{"r_frame_rate": "30000/1001", "width": 1920, "height": 1080, "duration": "10.5"}],
        "format": {"duration": "10.5"},
    })
    assert abs(meta.fps - 29.97002997) < 1e-6
    assert meta.width == 1920 and meta.height == 1080
    assert meta.duration_seconds == 10.5


def test_zero_denominator_rate_is_guarded():
    meta = parse_probe_metadata({"streams": [{"r_frame_rate": "0/0", "width": 640, "height": 480}]})
    assert meta.fps == 0.0


def test_missing_stream_duration_falls_back_to_format():
    meta = parse_probe_metadata({
        "streams": [{"r_frame_rate": "25/1", "width": 1280, "height": 720}],
        "format": {"duration": "42.25"},
    })
    assert meta.duration_seconds == 42.25


def test_no_video_stream_returns_none():
    assert parse_probe_metadata({"streams": [], "format": {"duration": "5"}}) is None


def test_missing_rate_yields_zero_fps_not_fabricated_30():
    meta = parse_probe_metadata({"streams": [{"width": 10, "height": 10, "duration": "1"}]})
    assert meta.fps == 0.0


def test_picks_video_stream_and_detects_audio():
    data = {"streams": [
        {"codec_type": "audio"},
        {"codec_type": "video", "width": 1920, "height": 1080, "r_frame_rate": "30/1"},
    ]}
    assert parse_probe_metadata(data).width == 1920
    assert has_audio_stream(data) is True
    assert has_audio_stream({"streams": data["streams"][1:]}) is False


def test_rotated_phone_footage_reports_display_size():
    meta = parse_probe_metadata({"streams": [{
        "codec_type": "video", "width": 1920, "height": 1080,
        "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}],
    }]})
    assert (meta.width, meta.height) == (1080, 1920)
    # VAAPI full-GPU decode doesn't autorotate, so the transcoder skips it
    assert is_rotated_90({"streams": [{"codec_type": "video", "tags": {"rotate": "90"}}]})
    assert not is_rotated_90({"streams": [{"codec_type": "video", "tags": {"rotate": "180"}}]})


def test_vertical_ladder_keeps_full_resolution():
    plan = plan_renditions(QUALITIES, 1080, 1920)
    assert {q: scale for q, (scale, _crf) in plan.items()} == {
        "1080p": "1080:1920", "720p": "720:1280", "360p": "360:640",
    }


def test_landscape_4k_ladder():
    plan = plan_renditions(QUALITIES, 3840, 2160)
    assert [scale for scale, _crf in plan.values()] == ["1920:1080", "1280:720", "640:360"]


def test_small_source_is_not_upscaled_and_duplicates_drop():
    plan = plan_renditions(QUALITIES, 854, 480)
    assert [scale for scale, _crf in plan.values()] == ["854:480", "640:360"]


def test_unknown_size_falls_back_to_landscape_boxes():
    plan = plan_renditions(QUALITIES, 0, 0)
    assert [scale for scale, _crf in plan.values()] == ["1920:1080", "1280:720", "640:360"]
