import { describe, expect, it } from "vitest";
import { containsPii, redactReviews, redactText } from "@/lib/redact";

const PII_TEXTS: [string, string][] = [
  ["Contact me at ravi.sharma@gmail.com for help.", "gmail"],
  ["My email is user123@outlook.in thanks.", "outlook"],
  ["Call me on +91 98765 43210 please.", "ph +91 spaced"],
  ["Ring 9876543210 anytime.", "phone plain"],
  ["Mobile 8796543210", "phone starts 8"],
  ["PAN ABCDE1234F needed for verification", "pan"],
  ["My PAN is AAAAA9999A", "pan all A"],
  ["Aadhaar 1234 5678 9012 was used", "aadhaar spaced"],
  ["Ref number 1234567890123456", "16-digit run"],
  ["Transfer done from ravi@ybl account", "upi ybl"],
  ["Refund to xyz@okaxis please", "upi okaxis"],
  ["Pay at mohit_07@paytm", "upi paytm"],
  ["See https://bit.ly/free-stocks-x for details", "url link"],
  ["Check www.growwtips.com/earn", "www url"],
  ["Thanks @suresh for the reply", "handle mention"],
];

describe("redactText masks PII", () => {
  for (const [fixture, label] of PII_TEXTS) {
    it(`masks ${label}`, () => {
      const out = redactText(fixture);
      expect(out).not.toContain(fixture.trim());
      expect(containsPii(out)).toBe(false);
      expect(out).toContain("[REDACTED]");
    });
  }

  it("is idempotent", () => {
    const once = redactText("mail ravi@ybl on +919876543210");
    expect(redactText(once)).toBe(once);
  });

  it("leaves normal finance/app text untouched", () => {
    const clean =
      "Order placed and executed in 2 seconds today, good app. Brokerage is low but statements slow.";
    expect(redactText(clean)).toBe(clean);
    expect(containsPii(clean)).toBe(false);
  });

  it("does not flag the mask literal itself", () => {
    expect(containsPii("[REDACTED]")).toBe(false);
  });
});

describe("redactReviews", () => {
  it("masks all reviews and drops empty ones", () => {
    const reviews = [
      { id: "a", title: "Great", text: "Reach me at a@b.com", rating: 5, date: "2026-09-01" },
      { id: "b", title: "", text: "@spammer", rating: 1, date: "2026-09-01" },
      { id: "c", title: "", text: "   ", rating: 1, date: "2026-09-01" },
    ];
    const out = redactReviews(reviews);
    expect(out.length).toBe(2);
    expect(containsPii(out[0].title + out[0].text)).toBe(false);
  });
});

describe("detector catches leftovers", () => {
  it("flags embedded phone in a sentence", () => {
    expect(containsPii("bank: 9988776655 ok")).toBe(true);
  });
  it("flags spaced account run", () => {
    expect(containsPii("ac no 1234 123456")).toBe(true);
  });
});