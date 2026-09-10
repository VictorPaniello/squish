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

  test("reports real progress parsed from ffmpeg's own -progress output as it encodes", async () => {
    const input = join(dir, "clip.mov")
    await writeFile(input, Buffer.alloc(2_000, 1))

    // Mimics the two things optimizeVideo() actually parses: a
    // "Duration: ..." line on stderr (ffmpeg prints this once, while
    // opening the input) and repeated "out_time=..." lines on stdout
    // (from -progress pipe:1, one per encoded chunk). The sleeps between
    // echoes are needed for the test itself, not for optimizeVideo(): a
    // real ffmpeg naturally paces its own progress lines a fraction of a
    // second apart, so each arrives as its own "data" event; a script
    // that prints all of them instantly can have the OS pipe buffer
    // coalesce several into one chunk, which optimizeVideo() correctly
    // collapses down to just the latest (documented in its own code) -
    // that's real, correct behavior, just not what this test wants to
    // exercise.
    await installFakeFfmpeg(`
      echo "Duration: 00:00:10.00, start: 0.000000, bitrate: 128 kb/s" >&2
      echo "out_time=00:00:02.500000"
      echo "progress=continue"
      sleep 0.05
      echo "out_time=00:00:05.000000"
      echo "progress=continue"
      sleep 0.05
      for arg; do out="$arg"; done
      printf 'x%.0s' $(seq 1 200) > "$out"
    `)

    const ratios: number[] = []
    const result = await optimizeVideo(input, dir, undefined, (ratio) => ratios.push(ratio))

    expect(result.outputPath.endsWith(".mp4")).toBe(true)
    // Real numbers parsed from the fake ffmpeg's own output: 2.5s/10s
    // and 5s/10s, plus the final onProgress(1) fired on a clean exit -
    // never claiming 100% until the process has actually succeeded.
    expect(ratios).toContain(0.25)
    expect(ratios).toContain(0.5)
    expect(ratios.at(-1)).toBe(1)
  })

  test("doesn't request progress output from ffmpeg when no onProgress callback is given", async () => {
    const input = join(dir, "clip.mov")
    await writeFile(input, Buffer.alloc(1_000, 1))

    const argsLog = join(dir, "args.log")
    await installFakeFfmpeg(`
      echo "$@" > "${argsLog}"
      for arg; do out="$arg"; done
      printf 'x%.0s' $(seq 1 100) > "$out"
    `)

    await optimizeVideo(input, dir)

    const args = await Bun.file(argsLog).text()
    expect(args).not.toContain("-progress")
    expect(args).not.toContain("-nostats")
  })

  test("surfaces ffmpeg's stderr when it fails", async () => {
    const input = join(dir, "clip.mov")
    await writeFile(input, "not a real video")

    await installFakeFfmpeg(`echo "Error: fake unsupported codec" >&2; exit 1`)

    await expect(optimizeVideo(input, dir)).rejects.toThrow(/fake unsupported codec/)
  })
})
