import type { Note } from "@/lib/types";

/**
 * Phase 8: package the weekly note as a standard .eml file the user can open
 * in any mail client and send to themselves (aka the no-OAuth fallback).
 * A real Gmail draft (OAuth + Gmail API) is an optional Phase 8b later.
 *
 * The .eml is deterministic except for the Date header, uses quoted-printable
 * so ★/emoji in verbatim quotes survive any client, and contains no secrets.
 */

/** Development default. Overridable via EMAIL_RECIPIENT env in prod. */
export const EMAIL_RECIPIENT_DEFAULT = "bidishapandit03@gmail.com";

export function emailRecipient(): string {
  return process.env.EMAIL_RECIPIENT?.trim() || EMAIL_RECIPIENT_DEFAULT;
}

export function emailSubject(note: Note): string {
  return `Groww Weekly Review Pulse - ${note.weekLabel}`;
}

export function toRfc2822(date: Date): string {
  return date.toUTCString();
}

const MAX_QP_LINE = 76;

function toHex(num: number): string {
  return num.toString(16).toUpperCase().padStart(2, "0");
}

/** Encode one line of content into QP atoms, soft-breaking at MAX_QP_LINE. */
function encodeLine(line: string): string {
  const atoms: string[] = [];
  for (const ch of line) {
    if (ch === "=") atoms.push("=3D");
    else if (ch >= "\u0021" && ch <= "\u007e") atoms.push(ch);
    else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) atoms.push(`=${toHex(b)}`);
    }
  }
  let out = "";
  let cur = 0;
  for (const atom of atoms) {
    if (cur + atom.length > MAX_QP_LINE && cur > 0) {
      out += "=\r\n";
      cur = 0;
    }
    out += atom;
    cur += atom.length;
  }
  return out;
}

/**
 * RFC 2045 quoted-printable: control/unicode/special chars as =XX, line
 * endings preserved as CRLF (per RFC 5322), long lines soft-wrapped.
 */
export function qpEncode(text: string): string {
  return text
    .replace(/\r?\n/g, "\n")
    .split("\n")
    .map(encodeLine)
    .join("\r\n");
}

export interface EmailOptions {
  to?: string;
  date?: Date;
}

/** Build the full .eml file contents for a validated note + its markdown. */
export function buildEml(
  note: Note,
  markdown: string,
  opts: EmailOptions = {},
): string {
  const to = opts.to ?? emailRecipient();
  const date = opts.date ?? new Date();
  const headers = [
    "MIME-Version: 1.0",
    `Date: ${toRfc2822(date)}`,
    `To: ${to}`,
    `Subject: ${emailSubject(note)}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "Content-Transfer-Encoding: quoted-printable",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + qpEncode(markdown) + (markdown.endsWith("\n") ? "" : "\r\n");
}

/** A clickable mailto: link with the note in the subject + body (no draft). */
export function mailtoUrl(note: Note, to?: string): string {
  const recipient = to ?? emailRecipient();
  const q = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  return `mailto:${recipient}?subject=${q(emailSubject(note))}&body=${q(note.weekLabel)}`;
}