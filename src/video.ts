import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import type { OptimizeResult } from "./images.ts"

export type VideoFormat = "mp4" | "webm"

export type VideoOptions = {
  /** Quality knob shared across both codecs - lower is higher
   * quality/bigger file. Note the two codecs don't share a CRF scale:
   * libx264 (mp4) runs roughly 0-51 and 23 is its own documented
   * "visually lossless for most content" default, while libvpx-vp9
   * (webm) runs roughly 0-63, so the same number lands as *higher*
   * relative quality (bigger file) on webm than on mp4. Reusing one
   * flag keeps the CLI simple; it's a documented trade-off, not a bug -
   * see CHANGELOG. */
  crf: number
  /** Caps the output's height; width scales to preserve aspect ratio.
   * A phone/camera's 4K export is far more resolution than this site
   * will ever display a video at. */
  maxHeight: number
  format: VideoFormat
}

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  crf: 23,
  maxHeight: 1080,
  format: "mp4",
}

/** Whether ffmpeg is on PATH - checked once up front rather than just
 * letting the first optimizeVideo() call fail, so the caller can print
 * one clear "ffmpeg not found" message and skip every video instead of
 * repeating the same failure per file. */
export function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"])
    proc.on("error", () => resolve(false))
    proc.on("exit", (code) => resolve(code === 0))
  })
}

export async function optimizeVideo(
  inputPath: string,
  outDir: string,
  options: VideoOptions = DEFAULT_VIDEO_OPTIONS,
  /** Called with a real 0-1 ratio (encoded time / total duration) as
   * ffmpeg reports its own progress - not a simulation, since a video
   * encode can genuinely take long enough for this to matter. Omitted
   * entirely when the caller doesn't want it, so a plain optimizeVideo()
   * call (as every existing test makes) doesn't pay for parsing it. */
  onProgress?: (ratio: number) => void
): Promise<OptimizeResult> {
  const name = basename(inputPath, extname(inputPath))
  const outputPath = join(outDir, `${name}.${options.format}`)

  // "min(maxHeight,ih)" leaves a source that's already shorter than
  // maxHeight untouched instead of upscaling it - same never-enlarge
  // principle as images.ts's withoutEnlargement. Shared by both formats.
  const scaleArgs = ["-vf", `scale=-2:'min(${options.maxHeight},ih)'`]

  const codecArgs =
    options.format === "mp4"
      ? [
          "-c:v",
          "libx264",
          "-crf",
          String(options.crf),
          "-preset",
          "slow",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          // Moves the moov atom to the front of the file, so a browser
          // can start playback before the whole file has downloaded -
          // mp4-specific, libwebm has no equivalent flag.
          "-movflags",
          "+faststart",
        ]
      : [
          "-c:v",
          "libvpx-vp9",
          "-crf",
          String(options.crf),
          // Constant-quality mode - required alongside -crf for VP9,
          // otherwise ffmpeg defaults to a target bitrate instead.
          "-b:v",
          "0",
          "-c:a",
          "libopus",
          "-b:a",
          "128k",
        ]

  // -progress pipe:1 makes ffmpeg emit clean, stable "key=value" lines
  // (documented, machine-readable output) to stdout as it encodes,
  // instead of us having to scrape its human-readable stats off stderr.
  // -nostats suppresses that human-readable duplicate so stderr stays
  // clean for the error-tail capture below. Both are only added when a
  // caller actually wants progress - otherwise ffmpeg runs exactly as
  // before, and nothing extra is parsed.
  const progressArgs = onProgress ? ["-nostats", "-progress", "pipe:1"] : []

  await runFfmpeg(["-y", "-i", inputPath, ...scaleArgs, ...codecArgs, ...progressArgs, outputPath], onProgress)

  const [before, after] = await Promise.all([stat(inputPath), stat(outputPath)])
  return { inputPath, outputPath, beforeBytes: before.size, afterBytes: after.size }
}

/** Parses an ffmpeg timestamp ("00:01:23.45" or "00:01:23.456000") into
 * seconds. Shared by the "Duration: ..." line ffmpeg prints once while
 * opening the input, and the repeated "out_time=..." lines it prints
 * while encoding (via -progress pipe:1) - both use the same format. */
function parseTimestamp(text: string): number | null {
  const match = text.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return null
  const [, hours, minutes, seconds] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

function runFfmpeg(args: string[], onProgress?: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args)
    let stderr = ""
    let totalSeconds: number | null = null

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderr += text
      if (totalSeconds === null) {
        const match = text.match(/Duration:\s*(\d+:\d+:\d+\.\d+)/)
        if (match) totalSeconds = parseTimestamp(match[1])
      }
    })

    if (onProgress) {
      proc.stdout.on("data", (chunk) => {
        // A single data event can carry several progress lines at once -
        // take the last "out_time=" in the chunk, since it's the most
        // current. Duration isn't known yet (still waiting on the
        // stderr line above) or is unparseable: skip this update rather
        // than divide by an unknown/zero total - the bar just stays put
        // until a usable Duration shows up, or jumps straight to 100%
        // when the process exits successfully.
        if (!totalSeconds) return
        const matches = [...chunk.toString().matchAll(/out_time=(\d+:\d+:\d+\.\d+)/g)]
        const last = matches.at(-1)
        if (!last) return
        const current = parseTimestamp(last[1])
        if (current !== null) onProgress(Math.min(current / totalSeconds, 1))
      })
    }

    proc.on("error", reject)
    // "close" (not "exit") - it fires only once the stdout/stderr pipes
    // have fully drained, so every progress line ffmpeg wrote right
    // before exiting is guaranteed to have already reached the "data"
    // handlers above. "exit" can fire first and race the last chunk.
    proc.on("close", (code) => {
      if (code === 0) {
        onProgress?.(1)
        resolve()
      }
      // Only the tail of ffmpeg's stderr - it logs a full line per
      // frame/progress update, and the actual error (if any) is almost
      // always in the last few lines, not buried at the top.
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.split("\n").slice(-15).join("\n")}`))
    })
  })
}
