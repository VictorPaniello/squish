import { stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import sharp from "sharp"

export type ImageFormat = "webp" | "avif" | "jpeg" | "png"

export type ImageOptions = {
  /** Longest edge, in px, after resizing. Never upscales a smaller
   * source (`withoutEnlargement`) - this is a ceiling, not a target. */
  maxDimension: number
  /** 1-100. Applies to webp/avif/jpeg; ignored for png, which is
   * lossless by format and compressed via sharp's own effort level
   * instead (see optimizeImage below). */
  quality: number
  format: ImageFormat
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  maxDimension: 2400,
  quality: 82,
  format: "webp",
}

export type OptimizeResult = {
  inputPath: string
  outputPath: string
  beforeBytes: number
  afterBytes: number
}

export async function optimizeImage(
  inputPath: string,
  outDir: string,
  options: ImageOptions = DEFAULT_IMAGE_OPTIONS
): Promise<OptimizeResult> {
  const name = basename(inputPath, extname(inputPath))
  const outputPath = join(outDir, `${name}.${options.format}`)

  let pipeline = sharp(inputPath)
    // Applies EXIF orientation before the resize/encode below, then
    // sharp's output strips metadata by default (no .withMetadata()
    // call) - without the explicit rotate() first, a photo shot in
    // portrait on a phone comes out sideways once the orientation tag
    // that would have corrected it for a viewer is gone.
    .rotate()
    .resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })

  switch (options.format) {
    case "webp":
      pipeline = pipeline.webp({ quality: options.quality })
      break
    case "avif":
      pipeline = pipeline.avif({ quality: options.quality })
      break
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: options.quality, mozjpeg: true })
      break
    case "png":
      pipeline = pipeline.png({ effort: 9 })
      break
  }

  await pipeline.toFile(outputPath)

  const [before, after] = await Promise.all([stat(inputPath), stat(outputPath)])
  return { inputPath, outputPath, beforeBytes: before.size, afterBytes: after.size }
}
