#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { basename } from "node:path"
import { Command } from "commander"
import { findMediaFiles } from "./files.ts"
import { formatBytes, formatSavings } from "./format.ts"
import { type ImageFormat, optimizeImage } from "./images.ts"
import { hasFfmpeg, optimizeVideo } from "./video.ts"

const program = new Command()

program
  .name("squish")
  .description(
    "Resize and re-encode photos (and video, via ffmpeg) for the web - smaller files, no visible quality loss."
  )
  .version("1.0.0")
  .argument("<input>", "an image/video file, or a directory of them (not recursive)")
  .option("-o, --out <dir>", "output directory", "./squished")
  .option("--max-dimension <px>", "max image dimension (longest edge)", "2400")
  .option("--quality <0-100>", "image quality", "82")
  .option(
    "--format <list>",
    "comma-separated output image format(s): webp,avif,jpeg,png",
    "webp,jpeg"
  )
  .option("--video-crf <n>", "video quality - lower is higher quality, bigger file", "23")
  .option("--video-max-height <px>", "max video height", "1080")
  .option("--skip-video", "skip video files entirely, even if ffmpeg is available", false)
  .action(main)

program.parseAsync(process.argv)

async function main(
  input: string,
  opts: {
    out: string
    maxDimension: string
    quality: string
    format: string
    videoCrf: string
    videoMaxHeight: string
    skipVideo: boolean
  }
) {
  const imageFormats = parseImageFormats(opts.format)
  const imageOptions = {
    maxDimension: parseIntArg(opts.maxDimension, "--max-dimension"),
    quality: parseIntArg(opts.quality, "--quality"),
  }
  const videoOptions = {
    crf: parseIntArg(opts.videoCrf, "--video-crf"),
    maxHeight: parseIntArg(opts.videoMaxHeight, "--video-max-height"),
  }

  const { images, videos } = await findMediaFiles(input)
  if (images.length === 0 && videos.length === 0) {
    console.log(`No image or video files found in ${input}`)
    return
  }

  await mkdir(opts.out, { recursive: true })

  let failures = 0

  if (images.length > 0) {
    console.log(`Images (${images.length}) -> ${opts.out}/ (${imageFormats.join(", ")})`)
    for (const path of images) {
      for (const format of imageFormats) {
        try {
          const result = await optimizeImage(path, opts.out, { ...imageOptions, format })
          logResult(result)
        } catch (err) {
          failures++
          console.error(`  ${basename(path)} (${format}): FAILED - ${(err as Error).message}`)
        }
      }
    }
  }

  if (videos.length > 0) {
    if (opts.skipVideo) {
      console.log(`\nSkipping ${videos.length} video(s) (--skip-video).`)
    } else if (!(await hasFfmpeg())) {
      console.log(
        `\nSkipping ${videos.length} video(s) - ffmpeg not found on PATH.\n` +
          `Install it (e.g. "sudo dnf install ffmpeg" on Fedora, "brew install ffmpeg" on macOS, ` +
          `or from https://ffmpeg.org/download.html) and re-run.`
      )
    } else {
      console.log(`\nVideo (${videos.length}) -> ${opts.out}/`)
      for (const path of videos) {
        try {
          const result = await optimizeVideo(path, opts.out, videoOptions)
          logResult(result)
        } catch (err) {
          failures++
          console.error(`  ${basename(path)}: FAILED - ${(err as Error).message}`)
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} file(s) failed.`)
    process.exit(1)
  }
}

function logResult(result: { inputPath: string; outputPath: string; beforeBytes: number; afterBytes: number }) {
  console.log(
    `  ${basename(result.inputPath)} -> ${basename(result.outputPath)}  ` +
      `${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)} ` +
      `(${formatSavings(result.beforeBytes, result.afterBytes)})`
  )
}

function parseIntArg(value: string, flag: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid value for ${flag}: "${value}" (expected a positive number)`)
    process.exit(1)
  }
  return n
}

/** Splits "webp,avif , jpeg" into ["webp", "avif", "jpeg"] - trims
 * whitespace around each entry (a space after the comma is a natural
 * thing to type) and drops duplicates (so "webp,webp" doesn't produce
 * the same file twice), but preserves the order given, since that's
 * also the order results print in. */
function parseImageFormats(value: string): ImageFormat[] {
  const valid: ImageFormat[] = ["webp", "avif", "jpeg", "png"]
  const requested = value
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)

  if (requested.length === 0) {
    console.error(`Invalid --format: "${value}" (expected at least one of ${valid.join(", ")})`)
    process.exit(1)
  }

  for (const format of requested) {
    if (!valid.includes(format as ImageFormat)) {
      console.error(`Invalid --format: "${format}" (expected one of ${valid.join(", ")})`)
      process.exit(1)
    }
  }

  return [...new Set(requested)] as ImageFormat[]
}
