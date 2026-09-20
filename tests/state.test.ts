import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * lib/state computes its Blob-vs-local choice at module load, so these tests
 * set process.env first, then import the module fresh via vi.resetModules().
 */
async function freshState() {
  vi.resetModules();
  return import("@/lib/state");
}

afterEach(() => {
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("state store on Vercel", () => {
  it("refuses local writes when BLOB_READ_WRITE_TOKEN is missing", async () => {
    process.env.VERCEL = "1";
    const { writeJson } = await freshState();
    await expect(writeJson("pipeline/x.json", { a: 1 })).rejects.toThrow(
      /BLOB_READ_WRITE_TOKEN is not set/,
    );
  });

  it("refuses local writes when the token is the 'local' placeholder", async () => {
    process.env.VERCEL = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "local";
    const { writeJson } = await freshState();
    await expect(writeJson("pipeline/x.json", { a: 1 })).rejects.toThrow(
      /BLOB_READ_WRITE_TOKEN is not set/,
    );
  });

  it("has a writable local store outside Vercel without a token", async () => {
    delete process.env.VERCEL;
    const { writeJson, removeJson } = await freshState();
    await writeJson("pipeline/_guard_test.json", { ok: true });
    await removeJson("pipeline/_guard_test.json");
  });
});