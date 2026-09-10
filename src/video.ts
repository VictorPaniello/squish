import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import type { OptimizeResult } from "./images.ts"

export type VideoOptions = {
  /** libx264 CRF - lower is higher quality/bigger file. 23 is x264's
   * own documented "visually lossless for most content" default; going
   * lower than ~18 stops paying off in any way a viewer would notice. */
  crf: number
  /** Caps the output's height; width scales to preserve aspect ratio.
   * A phone/camera's 4K export is far more resolution than this site
   * will ever display a video at. */
  maxHeight: number
}

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  crf: 23,
  maxHeight: 1080,
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
  const outputPath = join(outDir, `${name}.mp4`)

  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    // "min(maxHeight,ih)" leaves a source that's already shorter than
    // maxHeight untouched instead of upscaling it - same
    // never-enlarge principle as images.ts's withoutEnlargement.
    "-vf",
    `scale=-2:'min(${options.maxHeight},ih)'`,
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
    // Moves the moov atom to the front of the file, so a browser can
    // start playback before the whole file has downloaded - without
    // it, ffmpeg's default placement makes every web video wait for a
    // full download first regardless of how small the file is.
    "-movflags",
    "+faststart",
    outputPath,
  ])

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
