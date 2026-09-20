import { del as blobDel, get as blobGet, put as blobPut } from "@vercel/blob";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * State store: Vercel Blob in production (when BLOB_READ_WRITE_TOKEN is set),
 * local JSON files under data/raw/ in development.
 *
 * Everything stored here is PRIVATE by default. Raw reviews contain user data
 * and must never be publicly readable; only the final note (zero PII) is ever
 * rendered on the public page.
 */

const LOCAL_ROOT = path.join(process.cwd(), "data/raw");
const isVercel = process.env.VERCEL === "1";
const hasBlob = Boolean(
  process.env.BLOB_READ_WRITE_TOKEN?.trim() &&
    process.env.BLOB_READ_WRITE_TOKEN !== "local",
);

/** /var/task on Vercel is read-only — never attempt local writes there. */
function assertWritable() {
  if (isVercel && !hasBlob) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set — the Vercel state store requires Vercel Blob. " +
        "Add the token (Settings → Environment Variables → Production) and redeploy.",
    );
  }
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

export async function readJson<T>(key: string): Promise<T | null> {
  if (hasBlob) {
    try {
      const res = await blobGet(key, { access: "private" });
      if (!res?.stream) return null;
      const text = await streamToString(res.stream);
      return JSON.parse(text) as T;
    } catch (err) {
      if ((err as { name?: string }).name === "BlobNotFoundError") return null;
      throw err;
    }
  }
  try {
    const text = await readFile(path.join(LOCAL_ROOT, key), "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (hasBlob) {
    await blobPut(key, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  assertWritable();
  const fp = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(fp), { recursive: true });
  await writeFile(fp, body, "utf8");
}

/** Public copy of a de-identified artifact (e.g. the weekly note). */
export async function writePublic(key: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (hasBlob) {
    await blobPut(key, body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  assertWritable();
  const fp = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(fp), { recursive: true });
  await writeFile(fp, body, "utf8");
}

export async function removeJson(key: string): Promise<void> {
  if (hasBlob) {
    await blobDel(key);
    return;
  }
  await rm(path.join(LOCAL_ROOT, key), { force: true });
}