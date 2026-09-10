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
  options: VideoOptions = DEFAULT_VIDEO_OPTIONS
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

  await runFfmpeg(["-y", "-i", inputPath, ...scaleArgs, ...codecArgs, outputPath])

  const [before, after] = await Promise.all([stat(inputPath), stat(outputPath)])
  return { inputPath, outputPath, beforeBytes: before.size, afterBytes: after.size }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args)
    let stderr = ""
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code === 0) resolve()
      // Only the tail of ffmpeg's stderr - it logs a full line per
      // frame/progress update, and the actual error (if any) is almost
      // always in the last few lines, not buried at the top.
      else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.split("\n").slice(-15).join("\n")}`))
    })
  })
}
