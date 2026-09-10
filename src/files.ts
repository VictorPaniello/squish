import { readdir, stat } from "node:fs/promises"
import { extname, join } from "node:path"

// Case-insensitive comparison happens at the call site (extname()
// results are lowercased before checking these sets) - kept here as the
// single source of truth for "what counts as a photo/video" rather than
// duplicating the list anywhere a caller might need it.
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp", ".avif"])
export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"])

export type MediaFiles = {
  images: string[]
  videos: string[]
}

/** Accepts a single file or a directory (non-recursive - a flat folder
 * of exports is the common case, and silently descending into
 * subfolders risks picking up files the caller didn't mean to include).
 * Anything that's neither an image nor a video extension is skipped,
 * not an error - a folder of camera exports often has sidecar files
 * (.xmp, .json, Thumbs.db) mixed in. */
export async function findMediaFiles(input: string): Promise<MediaFiles> {
  const info = await stat(input)
  const candidates = info.isFile() ? [input] : await listDirectoryFiles(input)

  const images: string[] = []
  const videos: string[] = []
  for (const path of candidates) {
    const ext = extname(path).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) images.push(path)
    else if (VIDEO_EXTENSIONS.has(ext)) videos.push(path)
  }
  return { images, videos }
}

async function listDirectoryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isFile()).map((e) => join(dir, e.name))
}
