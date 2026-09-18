import { COUNTRY, IOS_APP_ID } from "@/lib/constants";
import type { Review } from "@/lib/types";
import { toDateOnly } from "@/lib/dates";

/** Apple's public customer-review RSS (India store). Returns all ~500 latest
 *  reviews across up to 10 pages of ~50 entries. Industry margin later
 *  accumulates into a persistent corpus to reach the 8-week window. */
const RSS_BASE =
  "https://itunes.apple.com/%s/rss/customerreviews/page=%d/id=%d/sortby=mostrecent/json";

interface RssEntry {
  "im:rating"?: { label?: string };
  "im:version"?: { label?: string };
  "im:userRatingCount"?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  id?: { label?: string };
  updated?: { label?: string };
  author?: { name?: { label?: string } }; // deliberately never read
}

export async function importAppStoreAll(): Promise<Review[]> {
  const url = (page: number) =>
    RSS_BASE.replace("%s", COUNTRY).replace("%d", String(page)).replace("%d", IOS_APP_ID);

  const reviews: Review[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(url(page), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) break;
    const json = (await res.json()) as { feed?: { entry?: RssEntry[] } };
    const entries = json.feed?.entry ?? [];
    if (entries.length === 0) break;
    for (const entry of entries) {
      const id = entry.id?.label ?? "";
      if (!id || seen.has(id)) continue;
      const date = toDateOnly(entry.updated?.label ?? "");
      if (!date) continue;
      seen.add(id);
      reviews.push({
        id: `appstore:${id}`,
        source: "appstore",
        rating: toRating(entry["im:rating"]?.label),
        title: (entry.title?.label ?? "").trim(),
        text: (entry.content?.label ?? "").trim().replace(/\s+/g, " "),
        date,
      });
    }
  }

  return reviews;
}

function toRating(label: string | undefined): number {
  const n = Number.parseInt(label ?? "", 10);
  return Number.isNaN(n) || n < 1 || n > 5 ? 1 : n;
}