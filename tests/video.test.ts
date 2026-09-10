import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hasFfmpeg, optimizeVideo } from "../src/video.ts"

let dir: string
let originalPath: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "squish-video-"))
  originalPath = process.env.PATH
})

afterEach(async () => {
  process.env.PATH = originalPath
  await rm(dir, { recursive: true, force: true })
})

/** Installs a fake `ffmpeg` executable on PATH for the duration of one
 * test, so process orchestration (spawn, wait, read the result back off
 * disk, surface stderr on failure) can be tested deterministically -
 * without depending on the real ffmpeg being installed (it isn't, in
 * this sandbox) or on real video encoding being correct, which is
 * ffmpeg's own concern, not squish's. */
async function installFakeFfmpeg(script: string): Promise<void> {
  const binDir = join(dir, "bin")
  await Bun.write(join(binDir, "ffmpeg"), `#!/bin/sh\n${script}\n`)
  await chmod(join(binDir, "ffmpeg"), 0o755)
  process.env.PATH = `${binDir}:${originalPath}`
}

describe("hasFfmpeg", () => {
  test("resolves false when ffmpeg isn't on PATH", async () => {
    process.env.PATH = ""
    expect(await hasFfmpeg()).toBe(false)
  })

  test("resolves true when a working ffmpeg is on PATH", async () => {
    await installFakeFfmpeg("exit 0")
    expect(await hasFfmpeg()).toBe(true)
  })
})

describe("optimizeVideo", () => {
  test("invokes ffmpeg and reports real before/after sizes from the files it produced", async () => {
    const input = join(dir, "clip.mov")
    await writeFile(input, Buffer.alloc(10_000, 1)) // stand-in "large" source

    // The fake ffmpeg doesn't re-encode anything - it just has to prove
    // optimizeVideo() passed it a real output path and actually waited
    // for it to finish before reading the result back. The output path
    // is always the last argument; walking every arg and keeping the
    // last one is the portable POSIX sh way to grab it (no arrays, no
    // bash-only ${!#} indirection).
    await installFakeFfmpeg(`
      for arg; do out="$arg"; done
      printf 'x%.0s' $(seq 1 1000) > "$out"
    `)

    const result = await optimizeVideo(input, dir)

    expect(result.outputPath.endsWith(".mp4")).toBe(true)
    expect(result.beforeBytes).toBe(10_000)
    expect(result.afterBytes).toBe(1000)
  })

  test("writes a .webm file and uses the vp9/opus codec args when format is webm", async () => {
    const input = join(dir, "clip.mov")
    await writeFile(input, Buffer.alloc(5_000, 1))

    // Captures the args it was invoked with (into a file, since the fake
    // ffmpeg's own stdout isn't easily inspected after the fact) so the
    // test can assert on the real codec selection, not just the output
    // extension - a wrong codec with a right extension would still pass
    // an extension-only check.
    const argsLog = join(dir, "args.log")
    await installFakeFfmpeg(`
      echo "$@" > "${argsLog}"
      for arg; do out="$arg"; done
      printf 'x%.0s' $(seq 1 500) > "$out"
    `)

    const result = await optimizeVideo(input, dir, { crf: 30, maxHeight: 720, format: "webm" })

    expect(result.outputPath.endsWith(".webm")).toBe(true)
    const args = await Bun.file(argsLog).text()
    expect(args).toContain("libvpx-vp9")
    expect(args).toContain("libopus")
    expect(args).not.toContain("libx264")
  })

  test("surfaces ffmpeg's stderr when it fails", async () => {
    const input = join(dir, "clip.mov")
    await writeFile(input, "not a real video")

    await installFakeFfmpeg(`echo "Error: fake unsupported codec" >&2; exit 1`)

    await expect(optimizeVideo(input, dir)).rejects.toThrow(/fake unsupported codec/)
  })
})
