"""Link previews for URLs pasted into comments (YouTube, Vimeo, TikTok).

The server only ever calls the fixed oEmbed endpoints below, never the pasted
URL itself, so a comment can't make it fetch an arbitrary host (no SSRF).
"""
import hashlib
import json
import logging
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..middleware.rate_limit import rate_limit
from ..services.redis_service import get_redis

router = APIRouter(tags=["embeds"])
logger = logging.getLogger(__name__)

CACHE_SECONDS = 24 * 3600
FETCH_TIMEOUT_SECONDS = 5


class EmbedResponse(BaseModel):
    provider: str
    url: str
    title: Optional[str] = None
    author_name: Optional[str] = None
    thumbnail_url: Optional[str] = None
    # Player iframe src when the video can play inline
    embed_url: Optional[str] = None


def _youtube_embed(url: urllib.parse.ParseResult, _oembed: dict) -> Optional[str]:
    if url.hostname == "youtu.be":
        video_id = url.path.strip("/").split("/")[0]
    else:
        video_id = urllib.parse.parse_qs(url.query).get("v", [""])[0]
        match = re.match(r"^/(shorts|embed|live)/([\w-]+)", url.path)
        if match:
            video_id = match.group(2)
    return f"https://www.youtube-nocookie.com/embed/{video_id}" if re.fullmatch(r"[\w-]{6,20}", video_id or "") else None


def _vimeo_embed(url: urllib.parse.ParseResult, _oembed: dict) -> Optional[str]:
    match = re.match(r"^/(\d+)", url.path)
    return f"https://player.vimeo.com/video/{match.group(1)}" if match else None


def _tiktok_embed(url: urllib.parse.ParseResult, oembed: dict) -> Optional[str]:
    # Short links (vm.tiktok.com) only reveal the id through oEmbed
    match = re.search(r"/video/(\d+)", url.path)
    video_id = match.group(1) if match else str(oembed.get("embed_product_id") or "")
    return f"https://www.tiktok.com/embed/v2/{video_id}" if video_id.isdigit() else None


@dataclass(frozen=True)
class Provider:
    name: str
    hosts: tuple[str, ...]
    oembed_endpoint: str
    embed_url: Callable[[urllib.parse.ParseResult, dict], Optional[str]]


PROVIDERS = (
    Provider("youtube", ("youtube.com", "youtu.be"), "https://www.youtube.com/oembed", _youtube_embed),
    Provider("vimeo", ("vimeo.com",), "https://vimeo.com/api/oembed.json", _vimeo_embed),
    Provider("tiktok", ("tiktok.com",), "https://www.tiktok.com/oembed", _tiktok_embed),
)


def _match_provider(url: urllib.parse.ParseResult) -> Optional[Provider]:
    host = (url.hostname or "").lower()
    for provider in PROVIDERS:
        if any(host == h or host.endswith("." + h) for h in provider.hosts):
            return provider
    return None


def _fetch_oembed(provider: Provider, url: str) -> dict:
    query = urllib.parse.urlencode({"url": url, "format": "json"})
    request = urllib.request.Request(
        f"{provider.oembed_endpoint}?{query}",
        headers={"User-Agent": "freeframed-embed/1.0"},
    )
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read(512 * 1024))


def _cache_get(key: str) -> Optional[dict]:
    try:
        cached = get_redis().get(key)
        return json.loads(cached) if cached else None
    except Exception:  # noqa: BROAD_EXCEPT_OK - cache is best effort.
        return None


def _cache_set(key: str, value: dict) -> None:
    try:
        get_redis().setex(key, CACHE_SECONDS, json.dumps(value))
    except Exception:  # noqa: BROAD_EXCEPT_OK - cache is best effort.
        pass


@router.get(
    "/embeds",
    response_model=EmbedResponse,
    dependencies=[Depends(rate_limit("embed", 60, 60))],
)
def get_embed(url: str = Query(..., max_length=2048)):
    """Public (share-page guests see comment links too); rate limited per IP."""
    parsed = urllib.parse.urlparse(url)
    provider = _match_provider(parsed) if parsed.scheme in ("http", "https") else None
    if provider is None:
        raise HTTPException(status_code=404, detail="No preview for this link")

    cache_key = f"embed:{hashlib.sha256(url.encode()).hexdigest()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return EmbedResponse(**cached)

    try:
        oembed = _fetch_oembed(provider, url)
    except Exception as error:  # noqa: BROAD_EXCEPT_OK - provider/network failure means no preview.
        logger.info("oEmbed fetch failed for %s: %s", provider.name, error)
        raise HTTPException(status_code=404, detail="No preview for this link")

    embed = EmbedResponse(
        provider=provider.name,
        url=url,
        title=oembed.get("title"),
        author_name=oembed.get("author_name"),
        thumbnail_url=oembed.get("thumbnail_url"),
        embed_url=provider.embed_url(parsed, oembed),
    )
    _cache_set(cache_key, embed.model_dump())
    return embed
