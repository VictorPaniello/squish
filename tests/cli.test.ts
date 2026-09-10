import { describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"

// End-to-end: runs the real CLI entrypoint as a subprocess, the same way
// a real user would - not calling into src/images.ts directly, so this
// also exercises argument parsing and the file-discovery/orchestration
// wiring in cli.ts that the per-module unit tests don't touch.
describe("squish CLI", () => {
  test("optimizes a directory of images end to end, producing the default webp+avif+jpeg trio in a per-file subfolder", async () => {
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

      // One subfolder per input file, named after it (without extension).
      expect(await readdir(outDir)).toEqual(["photo"])

      const produced = await readdir(join(outDir, "photo"))
      expect(produced.sort()).toEqual(["photo.avif", "photo.jpeg", "photo.webp"])

      const meta = await sharp(join(outDir, "photo", "photo.webp")).metadata()
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(500)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)

  test("--format accepts a comma-separated list and produces one file per format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squish-cli-multiformat-"))
    try {
      const raw = Buffer.alloc(800 * 600 * 3)
      for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
      await sharp(raw, { raw: { width: 800, height: 600, channels: 3 } })
        .jpeg({ quality: 100 })
        .toFile(join(dir, "photo.jpg"))

      const outDir = join(dir, "out")
      const proc = Bun.spawn(
        [
          "bun",
          "run",
          join(import.meta.dir, "../src/cli.ts"),
          dir,
          "--out",
          outDir,
          // Deliberately includes extra whitespace and a duplicate -
          // both should be handled, not produce a duplicate file or a
          // parse error.
          "--format",
          "webp, avif,webp, jpeg",
        ],
        { stdout: "pipe", stderr: "pipe" }
      )
      const exitCode = await proc.exited

      expect(exitCode).toBe(0)

      const produced = await readdir(join(outDir, "photo"))
      expect(produced.sort()).toEqual(["photo.avif", "photo.jpeg", "photo.webp"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)

  test("--video-format accepts a comma-separated list and produces one file per format, in the file's subfolder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squish-cli-video-multiformat-"))
    try {
      // A fake ffmpeg on PATH: the CLI test suite doesn't depend on
      // ffmpeg being installed (it isn't, in this sandbox) or on real
      // encoding correctness, which is ffmpeg's own concern - see
      // video.test.ts for the same pattern applied directly. Unlike
      // video.test.ts's version, this one goes through the real CLI,
      // which calls hasFfmpeg() first (`ffmpeg -version`, no output
      // path) before ever encoding - the "grab the last arg as an
      // output path" trick must not fire for that call, or it writes a
      // stray file named "-version" into the process's cwd.
      const binDir = join(dir, "bin")
      await Bun.write(
        join(binDir, "ffmpeg"),
        `#!/bin/sh\n` +
          `if [ "$1" = "-version" ]; then exit 0; fi\n` +
          `for arg; do out="$arg"; done\n` +
          `printf 'x%.0s' $(seq 1 100) > "$out"\n`
      )
      await chmod(join(binDir, "ffmpeg"), 0o755)

      const inputDir = join(dir, "input")
      await Bun.write(join(inputDir, "clip.mp4"), Buffer.alloc(1000, 1))

      const outDir = join(dir, "out")
      const proc = Bun.spawn(
        ["bun", "run", join(import.meta.dir, "../src/cli.ts"), inputDir, "--out", outDir],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } }
      )
      const exitCode = await proc.exited

      expect(exitCode).toBe(0)

      const produced = await readdir(join(outDir, "clip"))
      expect(produced.sort()).toEqual(["clip.mp4", "clip.webm"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15_000)

  test("rejects an invalid --format value with a clear error and non-zero exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "squish-cli-bad-format-"))
    try {
      const raw = Buffer.alloc(200 * 150 * 3)
      await sharp(raw, { raw: { width: 200, height: 150, channels: 3 } }).jpeg().toFile(join(dir, "photo.jpg"))

      const proc = Bun.spawn(
        ["bun", "run", join(import.meta.dir, "../src/cli.ts"), dir, "--format", "webp,bogus"],
        { stdout: "pipe", stderr: "pipe" }
      )
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

      expect(exitCode).toBe(1)
      expect(stderr).toContain('Invalid --format: "bogus"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 10_000)

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
