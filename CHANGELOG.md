# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); nothing has been
tagged as a release yet, so everything below is under `[Unreleased]`.

## [Unreleased]

### Added
- Initial implementation: `optimizeImage` (sharp - resize to a max
  dimension without upscaling, EXIF auto-rotate then strip, re-encode as
  WebP/AVIF/JPEG/PNG) and `optimizeVideo` (ffmpeg - scale, re-encode
  H.264/AAC, `faststart`), plus `findMediaFiles` (flat-directory image/
  video discovery) and `hasFfmpeg` (graceful skip when ffmpeg isn't
  installed, rather than failing).
- `squish` CLI (Commander): resizes/re-encodes every image and video in a
  file or directory, prints a per-file before/after size and percentage
  saved.
- Test suite: 21 tests across image resizing/format/never-upscale
  behavior, media file discovery, byte-size formatting, video process
  orchestration (a fake `ffmpeg` binary on `PATH`, so process spawning,
  waiting, and error-surfacing are tested deterministically without
  depending on ffmpeg actually being installed or on real video encoding
  correctness, which is ffmpeg's own concern), and a real end-to-end CLI
  smoke test that spawns the actual entrypoint as a subprocess.
- GitHub Actions CI (lint via `oxlint`, typecheck via `tsc`, tests via
  `bun test`).
- MIT license.

### Fixed
- **Sharp reports an AVIF file's read-back format as `"heif"`, not
  `"avif"`** - AVIF is an HEIF-family container. Found running the format
  test, not assumed: the first version of that test asserted `"avif"` and
  failed against every real AVIF file `squish` itself produces. The file
  extension `squish` writes is unaffected (still `.avif`) - this only
  affects what sharp's own `metadata()` calls the codec once it reads a
  file back, which the test now asserts correctly.
