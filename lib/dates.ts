/** Converts an arbitrary incoming date string to YYYY-MM-DD, or null. */
export function toDateOnly(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO date (YYYY-MM-DD) `weeks` weeks before today. */
export function weeksAgoIso(weeks: number): string {
  return daysAgoIso(weeks * 7);
}

/** ISO date (YYYY-MM-DD) `days` days before today. */
export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return toDateOnly(d.toISOString()) as string;
}

/** ISO week number (1-53) for a YYYY-MM-DD date. */
export function isoWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return week;
}

/** ISO year+week label like 2026-W38 for a YYYY-MM-DD date. */
export function isoYearWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCFullYear()}-W${String(isoWeek(dateStr)).padStart(2, "0")}`;
}