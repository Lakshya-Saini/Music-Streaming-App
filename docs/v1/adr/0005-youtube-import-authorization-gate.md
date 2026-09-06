# ADR-0005: Host allow-list + explicit authorization flag for YouTube import

## Status

Accepted

## Context

`yt-dlp`, the tool used to download audio for the YouTube import feature, supports downloading from thousands of sites, not just YouTube — and downloading copyrighted audio the operator doesn't have rights to is a real legal/policy risk this app should not make easy to do by accident. The import feature is meant specifically for bringing in content the operator is already authorized to use (e.g. their own uploads, licensed content, public-domain material), not as a general-purpose media downloader.

## Decision

Two independent gates, both enforced server-side (not just in the UI):

1. **Host allow-list** (`YoutubeImportService.assertAllowedUrl`): only `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`, and `www.youtu.be` hostnames are accepted. Any other URL — even one `yt-dlp` itself could technically handle — is rejected with a 400 before any subprocess runs.
2. **Explicit authorization confirmation**: `ImportYoutubeTrackDto.authorizationConfirmed` is a required boolean; `TracksService.importFromYoutube` throws immediately if it isn't `true`. The client UI enforces this with a required, unchecked-by-default checkbox ("I confirm I have the rights to download and use this content.") that gates the Import button.

Additional content-level checks in `fetchMetadata`: live streams are rejected, videos flagged `private`/`needs_auth`/`premium_only`/`subscriber_only` are rejected, and videos longer than 2 hours are rejected (guards against accidentally importing something enormous or inappropriate for a per-track catalog entry).

## Consequences

- The feature cannot silently be used against arbitrary sites `yt-dlp` supports, even by directly calling the API (not just by using the UI) — the DTO validation and hostname check both happen server-side.
- The authorization flag is an attestation, not a technical enforcement of licensing — the app still trusts the operator's word, matching an internal/self-hosted tool's realistic threat model rather than pretending to solve rights management.
- If the app later needs to support other platforms, each would need its own explicit addition to `ALLOWED_HOSTNAMES`, keeping the allow-list (not a deny-list) as the safe default.
