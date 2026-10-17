# SPEC-025: Download metadata tagging

**Status:** Draft
**Date:** 2026-10-17
**Depends on:** SPEC-008 (audio download), SPEC-004 (ad block)
**Relates to:** Issue #18 (thumbnail), #36 (first frame)

## 1. Goal

Enrich downloaded audio filenames with artist/channel metadata. The filename becomes "Author - Title.ext" instead of "Title.ext". Binary ID3/M4A tag embedding is a future enhancement (research first). Keep the single-file contract and desktop-only, optional-`downloads`-gated behavior.

## 2. Non-goals

- No binary ID3/M4A tag embedding in 1.1.0 (research spike for 1.2.0+).
- No new permissions.
- No UI beyond optional filename template in Downloads → Advanced.

## 3. Design

### 3.1 Filename enrichment

- `buildAudioFilename(title, itag, author?)` prepends "Author - " to title when author is provided.
- `sanitizeDownloadTitle` applied to both title and author.
- Combined string sliced to `MAX_FILENAME_LENGTH - extension.length`.
- Fallback to `FALLBACK_TITLE` if combined is empty.

### 3.2 Download handler

- Extract `author` from `playerResponse.videoDetails.author` in main-world.ts.
- Pass to `buildAudioFilename(title, format.itag, author)`.
- If author is missing or not a string, filename is title-only (backward compatible).

### 3.3 Fail-open

- If metadata extraction fails, download uses title-only filename.
- If sanitization produces empty string, fallback to `FALLBACK_TITLE`.

## 4. Test strategy

- Unit: buildAudioFilename with/without author, sanitization, length truncation.
- Bench: download case with author metadata.
- Manual: verify filename in downloads folder.

---

_Spec written per "no spec, no code" rule._
