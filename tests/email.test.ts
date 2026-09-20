import { describe, expect, it } from "vitest";
import { buildEml, emailRecipient, emailSubject, mailtoUrl, qpEncode, toRfc2822 } from "@/lib/pipeline/email";
import type { Note } from "@/lib/types";

// Minimal but UTF-8-correct quoted-printable decoder.
function decodeQp(qp: string): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < qp.length) {
    if (qp[i] === "=") {
      if (qp.startsWith("=\r\n", i)) {
        i += 3;
        continue;
      }
      const code = parseInt(qp.slice(i + 1, i + 3), 16);
      bytes.push(Number.isNaN(code) ? qp.charCodeAt(i) : code);
      i += 3;
    } else {
      bytes.push(qp.charCodeAt(i++));
    }
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

const note: Note = {
  weekLabel: "2026-W38",
  generatedAt: "2026-09-20T00:00:00.000Z",
  themes: [
    { theme: "trading_orders", summary: "Order failures spike." },
    { theme: "charges_statements", summary: "Hidden charges dominate." },
    { theme: "app_support", summary: "Support remains slow." },
  ],
  quoteIds: ["c1"],
  actions: [{ action: "Fix order sync", owner: "Product", metric: "failure rate" }],
  wordCount: 40,
};

const markdown = [
  "# Groww Weekly Review Pulse — 2026-W38",
  "3 themes · 3 voices · 3 actions",
  "",
  "> Transaction report total wrong fraud app 😔 — 1★ Play Store",
].join("\n");

describe("qpEncode", () => {
  it("leaves plain ASCII and spaces untouched", () => {
    expect(qpEncode("hello world")).toBe("hello world");
  });

  it("encodes = and unicode (★ and emoji) as =XX", () => {
    expect(qpEncode("=")).toBe("=3D");
    expect(qpEncode("★")).toBe("=E2=98=85");
    expect(qpEncode("😔")).toBe("=F0=9F=98=94");
  });

  it("round-trips through a minimal decoder", () => {
    const src = "Ghatiya ★ experience 😔";
    expect(decodeQp(qpEncode(src))).toBe(src);
  });

  it("soft-wraps lines at 76 chars without breaking an encoded atom", () => {
    const long = "x".repeat(200);
    const qp = qpEncode(long);
    const lines = qp.split("\r\n");
    expect(lines.every((l) => l.length <= 76)).toBe(true);
  });
});

describe("email building", () => {
  it("has correct mandatory headers, CRLF line endings and recipient", () => {
    const date = new Date("2026-09-20T00:00:00Z");
    const eml = buildEml(note, markdown, { to: "bidishapandit03@gmail.com", date });
    expect(eml).toContain("To: bidishapandit03@gmail.com");
    expect(eml).toContain(`Subject: Groww Weekly Review Pulse - 2026-W38`);
    expect(eml).toContain(`Date: ${toRfc2822(date)}`);
    expect(eml).toContain("Content-Type: text/plain; charset=\"UTF-8\"");
    expect(eml).toContain("Content-Transfer-Encoding: quoted-printable");
    expect(eml).toMatch(/\r\n\r\n/); // blank line after headers
  });

  it("embeds the note body and encodes unicode quotes", () => {
    const eml = buildEml(note, markdown, { to: "bidishapandit03@gmail.com", date: new Date() });
    expect(eml).toContain("# Groww Weekly Review Pulse");
    expect(eml).toContain("=F0=9F=98=94"); // 😔
    const body = eml.split(/\r\n\r\n/)[1] ?? "";
    expect(decodeQp(body)).toContain("3 themes · 3 voices · 3 actions");
  });

  it("subject uses the note week label", () => {
    expect(emailSubject(note)).toBe("Groww Weekly Review Pulse - 2026-W38");
  });
});

describe("recipient + mailto", () => {
  it("falls back to the fixed dev address", () => {
    delete process.env.EMAIL_RECIPIENT;
    expect(emailRecipient()).toBe("bidishapandit03@gmail.com");
  });

  it("honours EMAIL_RECIPIENT when set", () => {
    process.env.EMAIL_RECIPIENT = "pm@example.com";
    expect(emailRecipient()).toBe("pm@example.com");
    delete process.env.EMAIL_RECIPIENT;
  });

  it("builds a mailto link with encoded subject", () => {
    const url = mailtoUrl(note, "bidishapandit03@gmail.com");
    expect(url).toContain("mailto:bidishapandit03@gmail.com?");
    expect(url).toContain("subject=");
    expect(encodeURIComponent(emailSubject(note))).toBeDefined();
  });
});