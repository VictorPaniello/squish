# squish

A CLI that resizes and re-encodes photos (and video, via `ffmpeg`) for the
web — smaller files, no visible quality loss.

## Why this exists

A phone or camera export is enormous by web standards: 4000px+ on the long
edge, 10-20MB videos, full EXIF metadata nobody's going to read. Uploading
that straight into a website means slow page loads for a visitor whose
screen is never going to render more than ~2000px wide anyway. The usual
fix — open every file in an image editor, resize, export, repeat — doesn't
scale past a handful of files, and it's exactly the kind of repetitive step
that should be a script instead of a habit.

`squish` does that step generically: point it at a file or a folder, it
caps every image to a sane maximum dimension, re-encodes it as WebP at a
quality setting that's visually indistinguishable from the source, and
strips the metadata — video gets the equivalent treatment via `ffmpeg`
(H.264, capped resolution, `faststart` so playback can begin before the
whole file has downloaded), if `ffmpeg` is installed.

Built while preparing for Forward Deployed Engineer roles, using
[Claude Code](https://claude.com/claude-code) as a pair-programmer, for the
same reason as [tidycsv](https://github.com/VictorPaniello/tidycsv): a
concrete "yes, I've actually done this" rather than just describing it.

**Real results**, not made-up numbers - `examples/coastline.jpg`, a real
photo:

```bash
squish examples/coastline.jpg
```

```
coastline.jpg -> coastline.webp  241KB -> 144KB (-41%)
```

A more modest number than the others below, on purpose to show it honestly:
this file was already a web-sized, already-compressed JPEG (2000px), not a
fresh camera export - and `squish` still finds real savings on top of that.
Three more, JPEG, 1-1.1MB each - a normal camera-sized export, the common
case:

```
Images (3) -> out/
  portrait.jpg -> portrait.webp  1.1MB -> 320KB (-71%)
  city.jpg -> city.webp  1.0MB -> 529KB (-51%)
  mountain.jpg -> mountain.webp  1.1MB -> 369KB (-67%)
```

A genuinely large one too, an unedited 9.6MB iPhone photo (4220×3087, real
EXIF included):

```
wildlife.jpg -> wildlife.webp  9.6MB -> 1.0MB (-89%)
```

Side by side at full size, none of these are distinguishable from their
source - including fine detail (mesh fabric texture, foliage) in the 9.6MB
photo. EXIF is gone from the output, verified by reading it back, not
assumed: the source carries real camera metadata (`Apple, iPhone 8 Plus`),
the output carries none.

A panorama pushes the ratio further still (17.6MB → 97KB, **-99%**) - but
that's the image's own 11:1 aspect ratio doing most of the work, not
compression: capping the *longest* edge at 2400px shrinks a 23680px-wide
source by ~10x linearly, ~100x in area. Worth knowing rather than assuming
every source compresses that hard.

## Install

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/VictorPaniello/squish.git
cd squish
bun install
```

Run it via `bun run src/cli.ts`, or link it as a global `squish` command:

```bash
bun link
squish --help
```

Video support additionally requires [`ffmpeg`](https://ffmpeg.org/download.html)
on your `PATH` — entirely optional: if it isn't installed, `squish` still
processes every image in the input and skips videos with a clear message
instead of failing.

## Usage

```bash
squish ./photos
```

- `<input>` (positional, required) — a single file or a directory of files
  (not recursive - a flat folder of exports is the common case).
- `--out, -o <dir>` — output directory. Defaults to `./squished`.
- `--max-dimension <px>` — longest edge after resizing. Defaults to `2400`
  — plenty for any screen this is likely to be viewed on. Never upscales a
  source that's already smaller.
- `--quality <0-100>` — image quality. Defaults to `82`.
- `--format <webp|avif|jpeg|png>` — output image format. Defaults to `webp`.
- `--video-crf <n>` — video quality (libx264 CRF, lower = higher quality,
  bigger file). Defaults to `23`, x264's own documented "visually lossless
  for most content" default.
- `--video-max-height <px>` — caps video height, width scales to match.
  Defaults to `1080`.
- `--skip-video` — skip video files entirely, even if `ffmpeg` is
  available.

```bash
squish ./photos --out public/photos --max-dimension 2000 --quality 85
```

## What it doesn't do (yet)

- Recurse into subdirectories — a flat input folder only.
- Fuzzy "is this basically the same photo as one already in the output
  folder" dedup — every input file gets processed independently.
- A progress bar / parallel processing — files are optimized one at a
  time, in order, which is simple and fine at the scale this is meant for
  (a folder of photos for a personal site, not a media pipeline processing
  thousands of files).

## Development

```bash
bun install
bun test
bun run typecheck
bun run lint
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
