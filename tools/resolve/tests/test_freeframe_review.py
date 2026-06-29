from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import freeframe_review as ff


class _FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return self._payload


class FreeFrameReviewTests(unittest.TestCase):
    def test_load_config_raises_when_file_missing(self) -> None:
        # Given: a path that does not exist.
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "missing.json"

            # When / Then: loading config reports an actionable bridge error.
            with self.assertRaises(ff.FreeFrameError):
                ff.load_config(path=path)

    def test_load_config_raises_when_json_is_malformed(self) -> None:
        # Given: malformed JSON at the config path.
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "config.json"
            path.write_text("{bad json")

            # When / Then: loading config reports an actionable bridge error.
            with self.assertRaises(ff.FreeFrameError):
                ff.load_config(path=path)

    def test_load_config_requires_api_key_and_strips_api_url_slash(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "config.json"

            # Given: a config missing api_key.
            path.write_text(json.dumps({"api_url": "http://api/", "project_id": "proj"}))

            # When / Then: loading config rejects the missing required key.
            with self.assertRaises(ff.FreeFrameError):
                ff.load_config(path=path)

            # Given: a complete config with a trailing slash in api_url.
            path.write_text(
                json.dumps(
                    {
                        "api_url": "http://api/",
                        "api_key": "secret",
                        "project_id": "proj",
                    }
                )
            )

            # When: config is loaded.
            cfg = ff.load_config(path=path)

            # Then: required values are present and api_url is normalized.
            self.assertEqual(cfg["api_url"], "http://api")
            self.assertEqual(cfg["api_key"], "secret")

    def test_build_multipart_stream_contains_fields_file_and_length(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "clip.mp4"
            file_bytes = b"video-bytes"
            path.write_bytes(file_bytes)

            # Given: a form field and a file path.
            fields = {"a": "1"}

            # When: a multipart stream is built and read.
            headers, body = ff._build_multipart(
                fields,
                "file",
                str(path),
                "clip.mp4",
                "video/mp4",
            )
            with body:
                payload = body.read()

            # Then: the payload contains the field, file metadata, file bytes, and advertised length.
            self.assertIn(b'Content-Disposition: form-data; name="a"', payload)
            self.assertIn(b"\r\n\r\n1\r\n", payload)
            self.assertIn(b'filename="clip.mp4"', payload)
            self.assertIn(b"Content-Type: video/mp4", payload)
            self.assertIn(file_bytes, payload)
            self.assertEqual(len(payload), int(headers["Content-Length"]))
            self.assertTrue(headers["Content-Type"].startswith("multipart/form-data; boundary="))

    def test_push_review_posts_ingest_request_and_returns_json(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "clip.mp4"
            path.write_bytes(b"video")
            captured_requests: List[object] = []

            def fake_urlopen(req, timeout=0):
                captured_requests.append(req)
                return _FakeResponse(b'{"token":"tok","url":"http://x/share/tok"}')

            cfg = {"api_url": "http://api", "api_key": "secret", "project_id": "proj"}

            # Given: urllib is patched at the network seam.
            with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                # When: a review video is pushed.
                result = ff.push_review(cfg, str(path), "Clip", "video/mp4", timeout=12)

            # Then: the ingest endpoint receives the request and parsed JSON is returned.
            self.assertEqual(result["token"], "tok")
            self.assertEqual(len(captured_requests), 1)
            req = captured_requests[0]
            self.assertEqual(req.full_url, "http://api/integrations/review-ingest")
            self.assertEqual(req.get_header("X-api-key"), "secret")
            self.assertEqual(req.get_method(), "POST")

    def test_fetch_comments_returns_list_and_rejects_non_list(self) -> None:
        cfg = {"api_url": "http://api"}
        captured_urls: List[str] = []

        def fake_list_urlopen(req, timeout=0):
            captured_urls.append(req.full_url)
            return _FakeResponse(b'[{"body":"hello","replies":[]}]')

        # Given: the comments endpoint returns a JSON list.
        with mock.patch("urllib.request.urlopen", side_effect=fake_list_urlopen):
            # When: comments are fetched.
            comments = ff.fetch_comments(cfg, "tok", timeout=7)

        # Then: the list round-trips and the token URL is used.
        self.assertEqual(comments, [{"body": "hello", "replies": []}])
        self.assertEqual(captured_urls, ["http://api/share/tok/comments"])

        def fake_dict_urlopen(req, timeout=0):
            return _FakeResponse(b'{"body":"not-list"}')

        # Given: the comments endpoint returns a non-list payload.
        with mock.patch("urllib.request.urlopen", side_effect=fake_dict_urlopen):
            # When / Then: the response shape is rejected.
            with self.assertRaises(ff.FreeFrameError):
                ff.fetch_comments(cfg, "tok")

    def test_save_and_load_link_use_sidecar_store(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            links_path = Path(tempdir) / "resolve_links.json"

            # Given: LINKS_PATH points at a temporary sidecar store.
            with mock.patch.object(ff, "LINKS_PATH", links_path):
                data: Dict[str, object] = {"token": "tok", "url": "http://x/share/tok"}

                # When: a timeline link is saved.
                ff.save_link("timeline", data)

                # Then: that timeline can be loaded and missing timelines return None.
                self.assertEqual(ff.load_link("timeline"), data)
                self.assertIsNone(ff.load_link("missing"))
                self.assertEqual(links_path.stat().st_mode & 0o777, 0o600)


class FreeFrameMarkerMappingTests(unittest.TestCase):
    def test_comment_to_marker_maps_timecode_to_frame_with_rounding_and_mark_in(self) -> None:
        # Given: a timecoded unresolved comment and a timeline mark-in frame.
        comment = {
            "id": "comment-1",
            "timecode_start": 1.26,
            "body": "Title lands late",
            "resolved": False,
            "author": {"name": "Avery"},
            "replies": [],
        }

        # When: the comment is mapped to Resolve marker arguments.
        marker = ff.comment_to_marker(comment, 24, mark_in_frame=10)

        # Then: seconds are rounded to frames and offset by mark_in_frame.
        self.assertEqual(marker["frameId"], 40)
        self.assertEqual(marker["color"], "Yellow")

        two_second_marker = ff.comment_to_marker(
            {
                "id": "comment-2",
                "timecode_start": 2.0,
                "body": "Exact two seconds",
            },
            24.0,
        )
        self.assertEqual(two_second_marker["frameId"], 48)

        marked_in_marker = ff.comment_to_marker(
            {
                "id": "comment-3",
                "timecode_start": 2.0,
                "body": "With mark in",
            },
            24.0,
            mark_in_frame=10,
        )
        self.assertEqual(marked_in_marker["frameId"], 58)

        thirty_fps_marker = ff.comment_to_marker(
            {
                "id": "comment-4",
                "timecode_start": 1.5,
                "body": "Thirty fps",
            },
            30.0,
        )
        self.assertEqual(thirty_fps_marker["frameId"], 45)

    def test_comment_to_marker_uses_resolved_color_and_custom_data_prefix(self) -> None:
        # Given: a resolved comment with an id.
        comment = {
            "id": "resolved-1",
            "timecode_start": 2.0,
            "body": "Fixed",
            "resolved": True,
            "author": {"name": "Devon"},
        }

        # When: the comment is mapped to Resolve marker arguments.
        marker = ff.comment_to_marker(comment, 24)

        # Then: resolved comments are green and carry FreeFrame customData.
        self.assertEqual(marker["frameId"], 48)
        self.assertEqual(marker["color"], "Green")
        self.assertEqual(marker["customData"], "freeframe:resolved-1")

    def test_comment_to_marker_builds_note_from_author_guest_and_reply_fallbacks(self) -> None:
        # Given: a guest-authored comment with logged-in, guest, and unnamed replies.
        comment = {
            "id": "thread-1",
            "timecode_start": 0,
            "body": "Main note",
            "guest_author": {"name": "Guest Reviewer"},
            "replies": [
                {"body": "Logged in reply", "author": {"name": "Editor"}},
                {"body": "Guest reply", "guest_author": {"name": "Client"}},
                {"body": "Anonymous reply"},
            ],
        }

        # When: the comment is mapped to Resolve marker arguments.
        marker = ff.comment_to_marker(comment, 24)

        # Then: the note preserves author/guest names and falls back to Reviewer.
        self.assertEqual(
            marker["note"],
            "\n".join(
                [
                    "Guest Reviewer: Main note",
                    "  > Editor: Logged in reply",
                    "  > Client: Guest reply",
                    "  > Reviewer: Anonymous reply",
                ]
            ),
        )

    def test_flatten_comments_filters_general_comments_and_preserves_order(self) -> None:
        # Given: comments with and without frame anchors.
        anchored_first = {"id": "a", "timecode_start": 1.0, "replies": [{"id": "r"}]}
        general = {"id": "b", "timecode_start": None}
        anchored_second = {"id": "c", "timecode_start": 2.0, "replies": []}

        # When: comments are flattened for marker creation.
        flattened = ff.flatten_comments([anchored_first, general, anchored_second])

        # Then: only top-level anchored comments remain, in input order.
        self.assertEqual(flattened, [anchored_first, anchored_second])


if __name__ == "__main__":
    unittest.main()
