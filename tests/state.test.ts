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
  delete process.env.BLOB_STORE_ID;
});

describe("state store on Vercel", () => {
  it("refuses local writes when no Blob store is connected", async () => {
    process.env.VERCEL = "1";
    const { writeJson } = await freshState();
    await expect(writeJson("pipeline/x.json", { a: 1 })).rejects.toThrow(
      /No Blob store is connected/,
    );
  });

  it("refuses local writes when the token is the 'local' placeholder", async () => {
    process.env.VERCEL = "1";
    process.env.BLOB_READ_WRITE_TOKEN = "local";
    const { writeJson } = await freshState();
    await expect(writeJson("pipeline/x.json", { a: 1 })).rejects.toThrow(
      /No Blob store is connected/,
    );
  });

  // OIDC: a connected store supplies BLOB_STORE_ID at runtime; the SDK pair
  // (BLOB_STORE_ID + rotating VERCEL_OIDC_TOKEN) authenticates without any
  // static secret. We assert the guard defers to the SDK rather than throwing.
  it("accepts a connected store via BLOB_STORE_ID (OIDC auth)", async () => {
    process.env.VERCEL = "1";
    process.env.BLOB_STORE_ID = "store_some_id";
    const { writeJson } = await freshState();
    let guardHit = false;
    try {
      await writeJson("pipeline/_oidc_test.json", { a: 1 });
    } catch (err) {
      guardHit = /No Blob store is connected/.test(err instanceof Error ? err.message : String(err));
    }
    expect(guardHit).toBe(false);
  });

  it("has a writable local store outside Vercel without a token", async () => {
    delete process.env.VERCEL;
    const { writeJson, removeJson } = await freshState();
    await writeJson("pipeline/_guard_test.json", { ok: true });
    await removeJson("pipeline/_guard_test.json");
  });
});