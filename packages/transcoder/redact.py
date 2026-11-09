"""Keep presigned S3 URLs out of error text.

The transcoder hands ffmpeg and ffprobe a presigned GET for the raw upload and
both print it back: `<url>: Server returned 403 Forbidden`, `Error opening input
file <url>.`, `Input #0, ... from '<url>':`. A timeout quotes it inside the argv
that `subprocess.TimeoutExpired` prints. That text ends up in the transcode
error, the `transcode_failed` event every project member receives, the Celery
result backend and the worker log.

What makes such a URL usable is its query string: the signature, plus the access
key id in X-Amz-Credential. So that is what goes. Scheme, host and path stay,
because the object key is what an operator needs to find the file.
"""
import re

# A `?` and the rest of its token. The token ends at whitespace or a quote, so a
# `.` inside a query value does not cut it short. It is matched first and checked
# for a signing parameter in a callback: testing in a lookahead instead rescans
# the token at every `?`, which is quadratic on a `?`-laden line ffmpeg echoes.
_QUERY = re.compile(r"\?[^\s'\"<>]*")
_SIGNING_PARAM = re.compile(
    r"(?:X-Amz-(?:Signature|Credential|Security-Token)|Signature|AWSAccessKeyId)=",
    re.IGNORECASE,
)
# Handed back after the redaction so `<url>.` and `<url>:` keep their `.` and `:`.
_TRAILING_PUNCTUATION = re.compile(r"[.,:;)\]]*$")


def _redact_query(match: re.Match) -> str:
    query = match.group(0)
    if not _SIGNING_PARAM.search(query):
        return query
    return "?<redacted>" + _TRAILING_PUNCTUATION.search(query).group(0)


def redact_presigned_urls(text: str) -> str:
    """`text` with the signed query string of every presigned URL replaced."""
    if not text:
        return text
    return _QUERY.sub(_redact_query, text)
