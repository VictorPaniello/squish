#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { basename, extname, join, relative } from "node:path"
import { Command } from "commander"
import { findMediaFiles } from "./files.ts"
import { formatBytes, formatSavings } from "./format.ts"
import { type ImageFormat, optimizeImage } from "./images.ts"
import { hasFfmpeg, optimizeVideo, type VideoFormat } from "./video.ts"

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
    "webp,avif,jpeg"
  )
  .option("--video-crf <n>", "video quality - lower is higher quality, bigger file", "23")
  .option("--video-max-height <px>", "max video height", "1080")
  .option("--video-format <list>", "comma-separated output video format(s): mp4,webm", "mp4,webm")
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
    videoFormat: string
    skipVideo: boolean
  }
) {
  const imageFormats = parseImageFormats(opts.format)
  const imageOptions = {
    maxDimension: parseIntArg(opts.maxDimension, "--max-dimension"),
    quality: parseIntArg(opts.quality, "--quality"),
  }
  const videoFormats = parseVideoFormats(opts.videoFormat)
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

  // Every input file gets its own subfolder under opts.out, named after
  // the file (without its original extension), holding every requested
  // output format side by side - so "coastline.jpg" becomes
  // "squished/coastline/coastline.{webp,avif,jpeg,png}" rather than one
  // flat folder mixing formats and files together.
  async function fileOutDir(path: string): Promise<string> {
    const name = basename(path, extname(path))
    const dir = join(opts.out, name)
    await mkdir(dir, { recursive: true })
    return dir
  }

  if (images.length > 0) {
    console.log(`Images (${images.length}) -> ${opts.out}/<name>/ (${imageFormats.join(", ")})`)
    for (const path of images) {
      const outDir = await fileOutDir(path)
      for (const format of imageFormats) {
        try {
          const result = await optimizeImage(path, outDir, { ...imageOptions, format })
          logResult(opts.out, result)
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
      console.log(`\nVideo (${videos.length}) -> ${opts.out}/<name>/ (${videoFormats.join(", ")})`)
      for (const path of videos) {
        const outDir = await fileOutDir(path)
        for (const format of videoFormats) {
          try {
            const result = await optimizeVideo(path, outDir, { ...videoOptions, format })
            logResult(opts.out, result)
          } catch (err) {
            failures++
            console.error(`  ${basename(path)} (${format}): FAILED - ${(err as Error).message}`)
          }
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} file(s) failed.`)
    process.exit(1)
  }

  console.log(`\nSuccessfully squished into ${opts.out}/!`)
}

function logResult(
  outRoot: string,
  result: { inputPath: string; outputPath: string; beforeBytes: number; afterBytes: number }
) {
  console.log(
    `  ${basename(result.inputPath)} -> ${relative(outRoot, result.outputPath)}  ` +
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
 * also the order results print in. Shared by --format and
 * --video-format, parameterized over each flag's valid values. */
function parseFormatList<T extends string>(value: string, flag: string, valid: readonly T[]): T[] {
  const requested = value
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)

  if (requested.length === 0) {
    console.error(`Invalid ${flag}: "${value}" (expected at least one of ${valid.join(", ")})`)
    process.exit(1)
  }

  for (const format of requested) {
    if (!valid.includes(format as T)) {
      console.error(`Invalid ${flag}: "${format}" (expected one of ${valid.join(", ")})`)
      process.exit(1)
    }
  }

  return [...new Set(requested)] as T[]
}

function parseImageFormats(value: string): ImageFormat[] {
  return parseFormatList(value, "--format", ["webp", "avif", "jpeg", "png"] as const)
}

function parseVideoFormats(value: string): VideoFormat[] {
  return parseFormatList(value, "--video-format", ["mp4", "webm"] as const)
}
