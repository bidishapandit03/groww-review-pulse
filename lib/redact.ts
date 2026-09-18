/**
 * PII redaction. This is a product requirement (PRD G3), not a nice-to-have:
 * any user-identifying detail must be masked before a review reaches an LLM
 * or any file/store. Detection and masking share the same patterns so a zero
 * residual check can guard every output.
 */

const MASK = "[REDACTED]";

// Order matters: URLs > emails > phones > PAN/aadhaar > long digits > UPI > handles.
const MASKING_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s"<>)]+/gi,
  /www\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"<>)]*)?/gi,
  /\b[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
  /\b(?:tel\s*[:+])?\+?91[\s.-]?[6-9]\d{9}\b/g,
  /(?<!\d)[6-9]\d{9}(?!\d)/g,
  /(?<!\d)[6-9]\d{4}\s\d{5}(?!\d)/g,
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
  /\b\d{12,}\b/g,
  /\b[\w][\w.-]*@(?:ybl|oksbi|okaxis|okicici|okhdfcbank|okpb|paytm|apl|axl|ibl|barodampay|cnrb|dlb|fbl|hdfcbank|icici|ikf|kaypay|kotak|mysbi|pingpay|sbi|upi|utkarsh|yesbank)\b/gi,
  /@[\w][\w.-]*/g,
];

const DETECTION_PATTERNS: RegExp[] = [
  ...MASKING_PATTERNS,
  /\b\d{4}\s\d{6}\b/g, // partial account-ish run with inner space
];

/** Mask every PII occurrence in a piece of text. Idempotent. */
export function redactText(text: string): string {
  let out = text;
  for (const pattern of MASKING_PATTERNS) {
    out = out.replace(pattern, MASK);
  }
  return out;
}

/** True if the text still contains anything that looks like PII. */
export function containsPii(text: string): boolean {
  for (const pattern of DETECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

/** Redact the title and body of one review. */
export function redactReview<T extends { title: string; text: string }>(
  review: T,
): T {
  return {
    ...review,
    title: redactText(review.title),
    text: redactText(review.text),
  };
}

/** Redact a list of reviews and drop reviews left with no content at all. */
export function redactReviews<T extends { title: string; text: string }>(
  reviews: T[],
): T[] {
  const out: T[] = [];
  for (const r of reviews) {
    const redacted = redactReview(r);
    if (!redacted.title.trim() && !redacted.text.trim()) continue;
    out.push(redacted);
  }
  return out;
}