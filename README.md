![squish](.github/banner.svg)

A CLI that resizes and re-encodes photos (and video, via `ffmpeg`) for the
web: smaller files, no visible quality loss.

## Why this exists

A phone or camera export is enormous by web standards: 4000px+ on the long
edge, 10-20MB videos, full EXIF metadata nobody's going to read. Uploading
that straight into a website means slow page loads for a visitor whose
screen is never going to render more than ~2000px wide anyway. The usual
fix (open every file in an image editor, resize, export, repeat) doesn't
scale past a handful of files, and it's exactly the kind of repetitive step
that should be a script instead of a habit.

`squish` does that step generically: point it at a file or a folder, it
caps every image to a sane maximum dimension, re-encodes it as WebP, AVIF,
and JPEG by default (or any mix of those plus PNG you ask for) at a
quality setting that's visually indistinguishable from the source, and
strips the metadata. Video gets the equivalent treatment via `ffmpeg`,
re-encoded as MP4 (H.264/AAC) and WebM (VP9/Opus) by default, both with
capped resolution, if `ffmpeg` is installed. Every input file gets its
own subfolder under `~/squished` (your home directory, by default - see
`--out` below), holding every requested format side by side, so
`photo.jpg` becomes `~/squished/photo/photo.{webp,avif,jpeg}`.

**Real results**, not made-up numbers - `examples/coastline.jpg`, a real
photo:

```bash
squish examples/coastline.jpg
```

```
Images (1) -> /home/you/squished/<name>/ (webp, avif, jpeg)
  coastline.jpg -> coastline/coastline.webp  241KB -> 144KB (-41%)
  coastline.jpg -> coastline/coastline.avif  241KB -> 200KB (-17%)
  coastline.jpg -> coastline/coastline.jpeg  241KB -> 209KB (-13%)

Successfully squished into /home/you/squished/!
```

Default output is WebP, AVIF, and JPEG, one subfolder per input file
(`squished/coastline/coastline.{webp,avif,jpeg}`) - a `<picture>` element
can serve the smallest format each visitor's browser supports and fall
back to JPEG for the rest, without a second tool run. PNG is available
(`--format png`) but deliberately left out of the default: PNG is
lossless, and a real photo compresses badly under it - the same source
above comes out as a 1.0MB PNG, **+326% bigger than the original**, not
smaller. PNG stays useful for what it's actually for (screenshots, flat-color
graphics with transparency), just not as a default for photographic
content. These numbers are more modest than the ones below, on purpose,
to show it honestly: this file was already a web-sized, already-compressed
JPEG (2000px), not a fresh camera export - and `squish` still finds real
savings on top of that. Three more (WebP only, `--format webp`), JPEG,
1-1.1MB each - a normal camera-sized export, the common case:

```
Images (3) -> out/<name>/ (webp)
  portrait.jpg -> portrait/portrait.webp  1.1MB -> 320KB (-71%)
  city.jpg -> city/city.webp  1.0MB -> 529KB (-51%)
  mountain.jpg -> mountain/mountain.webp  1.1MB -> 369KB (-67%)
```

A genuinely large one too, an unedited 9.6MB iPhone photo (4220×3087, real
EXIF included):

```
wildlife.jpg -> wildlife/wildlife.webp  9.6MB -> 1.0MB (-89%)
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

```bash
npm install -g squish-cli
```

The package is named `squish-cli` on npm (`squish` was already taken), but
the command it installs is `squish`:

```bash
squish --help
```

### From source

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
on your `PATH` (entirely optional: if it isn't installed, `squish` still
processes every image in the input and skips videos with a clear message
instead of failing).

## Usage

```bash
squish ./photos
```

- `<input>` (positional, required): a single file or a directory of files
  (not recursive - a flat folder of exports is the common case).
- `--out, -o <dir>`: output directory. Defaults to `~/squished`
  (your home directory), so running `squish` from anywhere always lands
  in the same predictable place instead of scattering a `squished/`
  folder into whatever directory you happened to be in. Every input file
  gets its own subfolder here, named after it (without its original
  extension) - `photo.jpg` becomes `<out>/photo/photo.{...}`, so
  requesting several formats for several files never mixes them together
  in one flat folder.
- `--max-dimension <px>`: longest edge after resizing. Defaults to `2400`
  (plenty for any screen this is likely to be viewed on). Never upscales a
  source that's already smaller.
- `--quality <0-100>`: image quality. Defaults to `82`.
- `--format <list>`: comma-separated output image format(s), any mix of
  `webp`, `avif`, `jpeg`, `png`. One file per requested format, per image.
  Defaults to `webp,avif,jpeg` - PNG is opt-in only (`--format png`), since
  it's lossless and makes a real photo *larger* than the source rather than
  smaller (see the coastline example above).
- `--video-crf <n>`: video quality, lower = higher quality/bigger file.
  Defaults to `23`. Shared across both video codecs below, though they
  don't share a CRF scale (see "What it doesn't do (yet)").
- `--video-max-height <px>`: caps video height, width scales to match.
  Defaults to `1080`.
- `--video-format <list>`: comma-separated output video format(s), any
  mix of `mp4` (H.264/AAC), `webm` (VP9/Opus). One file per requested
  format, per video. Defaults to `mp4,webm` - the two video formats every
  major browser plays natively; `mov`/`avi`/`mkv` aren't offered as
  *output* formats (only as recognized *input* ones) since none of them
  has reliable native browser playback.
- `--skip-video`: skip video files entirely, even if `ffmpeg` is
  available.

```bash
squish ./photos --out public/photos --max-dimension 2000 --quality 85
```

Running in a real terminal shows a live `coastline.jpg -> webp
[#####-----] 50%` progress bar - one per individual conversion (one
input file into one format), resetting to a fresh bar the moment the
previous one hits 100%. For **video**, that percentage is real: parsed
straight from `ffmpeg`'s own progress reporting (encoded time ÷ total
duration) as it encodes. For **images**, there's no equivalent signal to
read - `sharp` doesn't expose intermediate progress for a single
encode, and most images finish in well under a second anyway - so the
bar there is a bounded animation (eases toward 90% on a timer, then
jumps to the real 100% the moment the file is actually written), never a
measurement. It's documented as simulated here so it's never mistaken
for the real number video gets. Both fall back to the plain per-file
lines only when output isn't a real terminal - piped to a file, captured
by a test, running in CI - since carriage-return tricks that overwrite
the previous line only make sense on a live screen.

## What it doesn't do (yet)

- Recurse into subdirectories: a flat input folder only.
- Fuzzy "is this basically the same photo as one already in the output
  folder" dedup: every input file gets processed independently.
- Parallel processing: files are optimized one at a time, in order,
  which is simple and fine at the scale this is meant for (a folder of
  photos for a personal site, not a media pipeline processing thousands
  of files). There is a progress bar (see below) - it just doesn't make
  the work itself go faster.
- A separate CRF flag per video codec: `--video-crf` feeds both `mp4`
  (libx264, ~0-51 scale) and `webm` (libvpx-vp9, ~0-63 scale). The same
  number lands as relatively higher quality (bigger file) on `webm` than
  on `mp4` - a known, documented trade-off for a simpler flag, not a bug.

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
