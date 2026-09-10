import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findMediaFiles } from "../src/files.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "squish-files-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function touch(name: string) {
  await writeFile(join(dir, name), "")
}

describe("findMediaFiles", () => {
  test("sorts a mixed directory into images and videos", async () => {
    await touch("photo.jpg")
    await touch("photo.PNG") // extension matching is case-insensitive
    await touch("clip.mp4")
    await touch("notes.txt") // not media - silently skipped, not an error

    const result = await findMediaFiles(dir)
    expect(result.images.sort()).toEqual([join(dir, "photo.PNG"), join(dir, "photo.jpg")].sort())
    expect(result.videos).toEqual([join(dir, "clip.mp4")])
  })

  test("accepts a single file directly", async () => {
    await touch("photo.jpg")
    const result = await findMediaFiles(join(dir, "photo.jpg"))
    expect(result.images).toEqual([join(dir, "photo.jpg")])
    expect(result.videos).toEqual([])
  })

  test("does not descend into subdirectories", async () => {
    await touch("top.jpg")
    const sub = join(dir, "subfolder")
    await mkdir(sub)
    await writeFile(join(sub, "nested.jpg"), "")

    const result = await findMediaFiles(dir)
    expect(result.images).toEqual([join(dir, "top.jpg")])
  })

  test("an empty directory returns no images and no videos", async () => {
    const result = await findMediaFiles(dir)
    expect(result.images).toEqual([])
    expect(result.videos).toEqual([])
  })
})
