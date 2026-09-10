import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { type ImageFormat, optimizeImage } from "../src/images.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "squish-images-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A real (if synthetic) photo-sized image - random noise, not a solid
 * color, so it actually exercises lossy compression the way a real
 * photo would rather than trivially collapsing to a few bytes. */
async function makeTestImage(path: string, width: number, height: number): Promise<void> {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
  await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toFile(path)
}

describe("optimizeImage", () => {
  test("resizes an oversized image down to maxDimension", async () => {
    const input = join(dir, "big.jpg")
    await makeTestImage(input, 4000, 3000)

    const result = await optimizeImage(input, dir, { maxDimension: 1000, quality: 82, format: "webp" })

    const outMeta = await sharp(result.outputPath).metadata()
    expect(Math.max(outMeta.width!, outMeta.height!)).toBeLessThanOrEqual(1000)
    // Aspect ratio preserved (4000x3000 = 4:3)
    expect(outMeta.width).toBe(1000)
    expect(outMeta.height).toBe(750)
  })

  test("never enlarges an image already smaller than maxDimension", async () => {
    const input = join(dir, "small.jpg")
    await makeTestImage(input, 200, 150)

    const result = await optimizeImage(input, dir, { maxDimension: 2400, quality: 82, format: "webp" })

    const outMeta = await sharp(result.outputPath).metadata()
    expect(outMeta.width).toBe(200)
    expect(outMeta.height).toBe(150)
  })

  test("produces a real reduction on a photo-like source", async () => {
    const input = join(dir, "photo.jpg")
    await makeTestImage(input, 3000, 2000)

    const result = await optimizeImage(input, dir, { maxDimension: 2400, quality: 82, format: "webp" })

    expect(result.afterBytes).toBeLessThan(result.beforeBytes)
  })

  test("writes the requested output format", async () => {
    const input = join(dir, "photo.jpg")
    await makeTestImage(input, 500, 400)

    // sharp reports AVIF's read-back format as "heif" - AVIF is an
    // HEIF-family container - not "avif". Found running this test, not
    // assumed; the file extension squish writes is still .avif either
    // way (checked separately below), this only affects what sharp's
    // own metadata() calls the codec once it reads the file back.
    const expectedMetadataFormat: Record<ImageFormat, string> = {
      webp: "webp",
      avif: "heif",
      jpeg: "jpeg",
      png: "png",
    }

    for (const format of ["webp", "avif", "jpeg", "png"] as const) {
      const result = await optimizeImage(input, dir, { maxDimension: 2400, quality: 82, format })
      expect(result.outputPath.endsWith(`.${format}`)).toBe(true)
      const outMeta = await sharp(result.outputPath).metadata()
      // Cast to string: bun:test infers toBe()'s expected type from
      // outMeta.format's own literal union (sharp's FormatEnum), which
      // a plain string lookup table can't satisfy structurally even
      // though the values are correct at runtime.
      expect(outMeta.format as string).toBe(expectedMetadataFormat[format])
    }
  })

  test("reports beforeBytes/afterBytes matching the real files on disk", async () => {
    const input = join(dir, "photo.jpg")
    await makeTestImage(input, 800, 600)

    const result = await optimizeImage(input, dir, { maxDimension: 2400, quality: 82, format: "webp" })

    const [inputStat, outputStat] = await Promise.all([stat(input), stat(result.outputPath)])
    expect(result.beforeBytes).toBe(inputStat.size)
    expect(result.afterBytes).toBe(outputStat.size)
  })
})
