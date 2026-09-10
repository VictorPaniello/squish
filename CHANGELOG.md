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
  saved. `--format` takes a comma-separated list (`webp,avif,jpeg,png`,
  default `webp,avif,jpeg`) and writes one file per requested format per
  image, so a single run can produce everything a `<picture>` element
  needs instead of running the tool once per format.
- `optimizeVideo` now takes a `format` option (`mp4` or `webm`), encoding
  `webm` via `libvpx-vp9`/`libopus` alongside the existing `mp4`
  (`libx264`/`aac`) path. `--video-format` mirrors `--format`'s
  comma-separated-list parsing, default `mp4,webm` - the two video
  formats every major browser plays natively. `mov`/`avi`/`mkv` stay
  recognized *input* extensions only; they were deliberately left out as
  *output* choices since none of them has reliable native browser
  playback, so re-encoding into them wouldn't serve the tool's actual
  purpose.
- Output layout: every input file now gets its own subfolder under the
  output directory, named after it - `photo.jpg` becomes
  `squished/photo/photo.{webp,avif,jpeg}` instead of a flat folder mixing
  every file and format together. A final `Successfully squished into
  <dir>/!` line prints once processing completes without failures.
  `--out` now defaults to `~/squished` (the invoking user's home
  directory) instead of `./squished` relative to the current working
  directory, so running `squish` from anywhere lands in the same
  predictable place.
- Live progress bar (`formatProgressBar` in `src/progress.ts`, a pure/
  testable formatter): an install-script style `[####------] 40%`, one
  per *individual conversion* (one input file into one format) -
  resetting to a fresh bar the moment the previous one reaches 100%,
  redrawn in place via `\r`. Gated on `process.stdout.isTTY` - piped
  output, log files, and the test suite's own subprocess capture all
  fall back to the plain per-file lines that already existed, unchanged,
  since overwriting the "previous line" is meaningless once nothing is
  live-rendering it.
- `optimizeVideo` takes an optional `onProgress(ratio)` callback, fed
  real numbers: `-progress pipe:1` makes `ffmpeg` emit clean
  machine-readable progress lines to stdout as it encodes, parsed
  alongside the `Duration:` line it prints on stderr while opening the
  input, giving a genuine (encoded time ÷ total duration) ratio - not a
  simulation. Only requested (and only parsed) when a caller passes the
  callback, so a plain `optimizeVideo()` call behaves exactly as before.
  `optimizeImage` gets no equivalent: `sharp` has no intermediate
  progress signal for a single encode to report, so the CLI instead
  animates that bar toward 90% on a fixed timer and jumps to the real
  100% only once the file is actually written - documented in the CLI
  and the README as a bounded animation, never claimed as a measurement.
- Test suite: 33 tests across image resizing/format/never-upscale
  behavior, media file discovery, byte-size formatting, video process
  orchestration (a fake `ffmpeg` binary on `PATH`, so process spawning,
  waiting, and error-surfacing are tested deterministically without
  depending on ffmpeg actually being installed or on real video encoding
  correctness, which is ffmpeg's own concern - including a test that
  asserts the real `libvpx-vp9`/`libopus` args are passed for `webm`, not
  just that the output extension is right, and a test that feeds a fake
  `ffmpeg`'s own `Duration:`/`out_time=` output through `onProgress` and
  asserts the real parsed ratios), CLI multi-format output for both
  images and video (including whitespace/duplicate handling in
  `--format` and a rejected invalid format), the per-file subfolder
  layout, progress-bar formatting (0%, 100%, partial fill, the
  divide-by-zero guard, the >100%-completed clamp), and a real
  end-to-end CLI smoke test that spawns the actual entrypoint as a
  subprocess.
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
- **`runFfmpeg` now resolves/rejects on ffmpeg's `close` event, not
  `exit`** - `exit` can fire before the stdout/stderr pipes have fully
  drained, racing the last progress line or the last chunk of stderr;
  `close` only fires once those streams are done. Found writing the
  progress-parsing test: the last `out_time=` update landed only
  sometimes until this changed.

### Known limitations
- **PNG is opt-in, not default, for a real measured reason**: running the
  default format set against `examples/coastline.jpg` produced a PNG
  **+326% larger** than the source (241KB → 1.0MB) - lossless PNG simply
  compresses a real photo badly. Found running the actual CLI against a
  real file, not assumed. PNG remains available via `--format png` for
  what it's actually good at (screenshots, flat-color graphics), just
  isn't in the default trio anymore.
- **`--video-crf` doesn't share a scale across codecs**: it's passed
  as-is to both `mp4`'s libx264 (~0-51 scale) and `webm`'s libvpx-vp9
  (~0-63 scale), so the same number is relatively higher quality (and a
  bigger file) on `webm` than on `mp4`. A simpler single flag was chosen
  over a second `--video-crf-webm` flag; documented here rather than
  silently accepted.
- **The image progress bar's simulated animation is tuned for `webp`/
  `jpeg`, not `avif`**: observed running the CLI for real against
  `examples/coastline.jpg` - `webp` and `jpeg` both finish well inside
  the 150ms the animation eases toward 90% over, but `avif` encoding is
  genuinely much slower in `sharp` (a known cost of AVIF's heavier
  compression), so its bar visibly sits at 90% for a real, noticeable
  stretch before the true 100%. Not a bug - the bar never claims 100%
  early - just an honest note that the animation's pacing was chosen for
  the common case, not AVIF's worst case.
