import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"

// End-to-end: runs the real CLI entrypoint as a subprocess, the same way
// a real user would - not calling into src/images.ts directly, so this
// also exercises argument parsing and the file-discovery/orchestration
// wiring in cli.ts that the per-module unit tests don't touch.
describe("squish CLI", () => {
  test("optimizes a directory of images end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squish-cli-"))
    try {
      const raw = Buffer.alloc(2000 * 1500 * 3)
      for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
      await sharp(raw, { raw: { width: 2000, height: 1500, channels: 3 } })
        .jpeg({ quality: 100 })
        .toFile(join(dir, "photo.jpg"))

      const outDir = join(dir, "out")
      const proc = Bun.spawn(
        ["bun", "run", join(import.meta.dir, "../src/cli.ts"), dir, "--out", outDir, "--max-dimension", "500"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const exitCode = await proc.exited

      expect(exitCode).toBe(0)

      const produced = await readdir(outDir)
      expect(produced).toEqual(["photo.webp"])

      const meta = await sharp(join(outDir, "photo.webp")).metadata()
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(500)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)

  test("exits cleanly with a message when the input has no media files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squish-cli-empty-"))
    try {
      const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "../src/cli.ts"), dir], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])

      expect(exitCode).toBe(0)
      expect(stdout).toContain("No image or video files found")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 10_000)
})
