"""Comment link previews: only allowlisted oEmbed providers are ever fetched."""
from unittest.mock import patch

import pytest

OEMBED = "apps.api.routers.embeds._fetch_oembed"


@pytest.fixture(autouse=True)
def _no_cache():
    with patch("apps.api.routers.embeds._cache_get", return_value=None), \
         patch("apps.api.routers.embeds._cache_set"):
        yield


@pytest.mark.parametrize(
    ("url", "embed_url"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
        ("https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
        ("https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"),
        ("https://www.tiktok.com/@neyako/video/7291234567890123456", "https://www.tiktok.com/embed/v2/7291234567890123456"),
    ],
)
def test_supported_links_return_preview_and_player(client, url, embed_url):
    with patch(OEMBED, return_value={"title": "Clip", "thumbnail_url": "https://i.test/t.jpg"}):
        resp = client.get("/embeds", params={"url": url})

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Clip"
    assert resp.json()["embed_url"] == embed_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:9000/freeframe/secret",
        "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
        "file:///etc/passwd",
    ],
)
def test_other_hosts_are_never_fetched(client, url):
    with patch(OEMBED) as fetch:
        resp = client.get("/embeds", params={"url": url})

    assert resp.status_code == 404
    fetch.assert_not_called()
