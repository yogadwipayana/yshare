// Small WebP previews for the gallery grid, so a phone doesn't download every full-size photo.

const SIZE = 480;
const MAX_CACHED = 400; // ~15 MB of thumbnails at most
const MAX_JOBS = 2; // Keeps CPU and RAM low while a phone scrolls through a big folder.

type Sharp = typeof import("sharp").default;

let loader: Promise<Sharp | null> | undefined;

/** sharp ships prebuilt binaries for common platforms only; without it the gallery shows originals. */
function loadSharp(): Promise<Sharp | null> {
  loader ??= import("sharp")
    .then(({ default: sharp }) => {
      sharp.cache(false);
      sharp.concurrency(1);
      return sharp;
    })
    .catch((err: Error) => {
      console.warn(`[galeri] sharp tidak tersedia, thumbnail memakai file asli: ${err.message}`);
      return null;
    });
  return loader;
}

const cache = new Map<string, Buffer>();
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_JOBS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Returns a WebP thumbnail, or null when it can't be made (the caller then sends the original). */
export async function getThumbnail(filePath: string, version: string): Promise<Buffer | null> {
  const key = `${filePath}\u0000${version}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // Move to the back: least recently used entries are evicted first.
    cache.set(key, hit);
    return hit;
  }

  const sharp = await loadSharp();
  if (!sharp) return null;

  try {
    const buffer = await withSlot(() =>
      sharp(filePath, { autoOrient: true, failOn: "none", limitInputPixels: 100_000_000 })
        .resize({ width: SIZE, height: SIZE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer(),
    );
    cache.set(key, buffer);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return buffer;
  } catch {
    return null;
  }
}
