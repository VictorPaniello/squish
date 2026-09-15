#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { cpus, homedir } from "node:os"
import { basename, extname, join, relative } from "node:path"
import { Command } from "commander"
import { findMediaFiles } from "./files.ts"
import { formatBytes, formatSavings } from "./format.ts"
import { buildImagePipeline, encodeImage, type ImageFormat } from "./images.ts"
import { formatProgressBar } from "./progress.ts"
import { hasFfmpeg, optimizeVideo, type VideoFormat } from "./video.ts"

const DEFAULT_OUT_DIR = join(homedir(), "squished")

/** Runs `worker` over `items` with at most `limit` in flight at once -
 * lets multiple files convert in parallel across CPU cores instead of
 * one-at-a-time, without pulling in a dependency for what a fixed pool
 * of self-refilling workers covers in a few lines. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function run() {
    while (next < items.length) {
      const item = items[next++]
      await worker(item as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
}

const program = new Command()

program
  .name("squish")
  .description(
    "Resize and re-encode photos (and video, via ffmpeg) for the web - smaller files, no visible quality loss."
  )
  .version("1.0.0")
  .argument("<input>", "an image/video file, or a directory of them (not recursive)")
  .option("-o, --out <dir>", "output directory", DEFAULT_OUT_DIR)
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

  const ffmpegAvailable = videos.length > 0 && !opts.skipVideo ? await hasFfmpeg() : false

  // An install-script style "[####------] 40%" bar, one per individual
  // conversion (one input file into one format) - reset to a fresh bar
  // for the next format the moment this one finishes, rather than one
  // bar spanning a whole file's formats or the whole run. Real
  // terminals only - piped/redirected output (a log file, a test
  // harness capturing stdout, CI) gets the plain line-per-result output
  // it always had instead: raw \r/ANSI bytes are meaningless once
  // they're not overwriting anything on a live screen.
  // Multiple files can now convert concurrently (see runPool below); a
  // live \r-redrawn bar only makes sense when a single conversion owns
  // the terminal line, so it's re-evaluated per batch against that
  // batch's concurrency instead of being fixed once for the whole run.
  let useProgressBar = process.stdout.isTTY === true

  /** Clears whatever progress bar (if any) is currently drawn on the
   * last line - safe to call even when nothing has been drawn yet. */
  function clearBar() {
    if (useProgressBar) process.stdout.write("\r\x1b[2K")
  }

  /** Prints a line that stays in the scrollback, then redraws the given
   * file's progress bar underneath it, so the bar always ends up back
   * on the last line rather than getting interleaved with real output. */
  function commitLine(text: string, renderBar: () => void, toStderr = false) {
    const write = toStderr ? console.error : console.log
    clearBar()
    write(text)
    renderBar()
  }

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

  /** Animates a bar toward 90% on a fixed timer, for a conversion that
   * has no real intermediate progress signal to report (sharp's own
   * image encode - see processFile below). This is NOT a measurement:
   * it never claims completion, and the caller is responsible for
   * calling stop() and then rendering the real 100% itself once the
   * actual work has finished - so a fast conversion just jumps straight
   * from wherever the animation had reached, and a slow one just sits
   * at 90% until the real result is ready. Documented as simulated in
   * the README/CHANGELOG so it's never mistaken for a real number. */
  function simulateProgress(render: (ratio: number) => void, estimatedMs = 150): () => void {
    const start = Date.now()
    const timer = setInterval(() => render(Math.min(0.9, (Date.now() - start) / estimatedMs)), 30)
    return () => clearInterval(timer)
  }

  /** Runs one file-into-one-format conversion, with its own progress
   * bar. The unit of work the pools below schedule - images pool at the
   * file level (formats run in sequence per file, sharing that file's
   * decoded pipeline - see the image loop), video pools at the
   * file*format level (each format is its own ffmpeg subprocess, so
   * there's no shared decode to lose by running them concurrently, and
   * a file with several formats otherwise leaves cores idle behind a
   * sequential format loop). `simulate` picks between video's real
   * ffmpeg-reported progress and images' bounded animation, since sharp
   * has no real signal to give. */
  async function processOneConversion<F extends string>(
    path: string,
    format: F,
    simulate: boolean,
    optimize: (
      format: F,
      onProgress: (ratio: number) => void
    ) => Promise<{ inputPath: string; outputPath: string; beforeBytes: number; afterBytes: number }>
  ): Promise<void> {
    const label = basename(path)
    const convLabel = `${label} -> ${format}`
    function renderBar(ratio: number) {
      if (!useProgressBar) return
      process.stdout.write(`\r\x1b[2K${convLabel} ${formatProgressBar(Math.round(ratio * 100), 100)}`)
    }

    renderBar(0)
    const stopSimulation = simulate ? simulateProgress(renderBar) : undefined
    try {
      const result = await optimize(format, renderBar)
      stopSimulation?.()
      renderBar(1)
      commitLine(formatResultLine(opts.out, result), () => {})
    } catch (err) {
      stopSimulation?.()
      failures++
      commitLine(`  ${label} (${format}): FAILED - ${(err as Error).message}`, () => {}, true)
    }
  }

  async function processFile<F extends string>(
    path: string,
    formats: F[],
    simulate: boolean,
    optimize: (
      format: F,
      onProgress: (ratio: number) => void
    ) => Promise<{ inputPath: string; outputPath: string; beforeBytes: number; afterBytes: number }>
  ): Promise<void> {
    for (const format of formats) await processOneConversion(path, format, simulate, optimize)
  }

  const poolSize = Math.max(1, cpus().length)

  if (images.length > 0) {
    commitLine(
      `Images (${images.length}) -> ${opts.out}/<name>/ (${imageFormats.join(", ")})`,
      () => {}
    )
    const concurrency = Math.min(poolSize, images.length)
    useProgressBar = process.stdout.isTTY === true && concurrency === 1
    await runPool(images, concurrency, async (path) => {
      const outDir = await fileOutDir(path)
      // Decoded once per file, then cloned per format below - avoids
      // re-reading and re-decoding the source image once per output
      // format.
      const pipeline = buildImagePipeline(path, imageOptions.maxDimension)
      await processFile(path, imageFormats, true, (format) =>
        encodeImage(pipeline.clone(), path, outDir, { ...imageOptions, format })
      )
    })
  }

  if (videos.length > 0) {
    if (opts.skipVideo) {
      commitLine(`\nSkipping ${videos.length} video(s) (--skip-video).`, () => {})
    } else if (!ffmpegAvailable) {
      commitLine(
        `\nSkipping ${videos.length} video(s) - ffmpeg not found on PATH.\n` +
          `Install it (e.g. "sudo dnf install ffmpeg" on Fedora, "brew install ffmpeg" on macOS, ` +
          `or from https://ffmpeg.org/download.html) and re-run.`,
        () => {}
      )
    } else {
      commitLine(
        `\nVideo (${videos.length}) -> ${opts.out}/<name>/ (${videoFormats.join(", ")})`,
        () => {}
      )
      // Pooled per file*format pair, not per file: each format is its
      // own ffmpeg subprocess with nothing shared between them (unlike
      // images' decode-once pipeline), so a file with several video
      // formats would otherwise sit behind a sequential per-format loop
      // even when other cores are free - the common case of a handful
      // of large videos each in both mp4 and webm.
      const tasks = videos.flatMap((path) => videoFormats.map((format) => ({ path, format })))
      const concurrency = Math.min(poolSize, tasks.length)
      useProgressBar = process.stdout.isTTY === true && concurrency === 1
      await runPool(tasks, concurrency, async ({ path, format }) => {
        const outDir = await fileOutDir(path)
        await processOneConversion(path, format, false, (fmt, onProgress) =>
          optimizeVideo(path, outDir, { ...videoOptions, format: fmt }, onProgress)
        )
      })
    }
  }

  clearBar()

  if (failures > 0) {
    console.error(`\n${failures} file(s) failed.`)
    process.exit(1)
  }

  console.log(`\nSuccessfully squished into ${opts.out}/!`)
}

function formatResultLine(
  outRoot: string,
  result: { inputPath: string; outputPath: string; beforeBytes: number; afterBytes: number }
): string {
  return (
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
