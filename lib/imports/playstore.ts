import { toDateOnly } from "@/lib/dates";
import { ANDROID_PACKAGE, COUNTRY } from "@/lib/constants";
import type { Review } from "@/lib/types";

/** Play Store reviews come from public store pages via google-play-scraper
 *  (no login). The public interface caps around ~1,800 newest; pages up to
 *  that ceiling so the corpus can accumulate history over weekly runs. */
export async function importPlayStoreAll(maxReviews = 2000): Promise<Review[]> {
  const { default: gplay } = await import("google-play-scraper");
  // gplay.sort.NEWEST = 2. The shipped typings declare non-exported enums,
  // so member access is blocked; the value is stable across versions.
  const newest: NonNullable<Parameters<typeof gplay.reviews>[0]["sort"]> = 2;

  const reviews: Review[] = [];
  let nextToken: string | undefined;
  const seen = new Set<string>();

  for (;;) {
    const page = await gplay.reviews({
      appId: ANDROID_PACKAGE,
      country: COUNTRY,
      lang: "en",
      sort: newest,
      num: 200,
      nextPaginationToken: nextToken,
    });

    for (const item of page.data) {
      if (seen.has(item.id)) continue;
      const date = toDateOnly(item.date);
      if (!date) continue;
      seen.add(item.id);
      reviews.push({
        id: `playstore:${item.id}`,
        source: "playstore",
        rating: clampScore(item.score),
        title: (item.title ?? "").trim(),
        text: (item.text ?? "").trim().replace(/\s+/g, " "),
        date,
      });
    }

    if (!page.nextPaginationToken || reviews.length >= maxReviews) break;
    nextToken = page.nextPaginationToken;
  }

  return reviews;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 1;
  return Math.min(5, Math.max(1, Math.round(score)));
}