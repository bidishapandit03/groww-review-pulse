import { buildEml } from "@/lib/pipeline/email";
import { composeMarkdown } from "@/lib/pipeline/note";
import { loadPulse } from "@/lib/pipeline/pulse";

export const dynamic = "force-dynamic";

/** Download the weekly pulse as a ready-to-send .eml file. */
export async function GET() {
  const pulse = await loadPulse();
  if (!pulse) {
    return new Response("No pulse yet — run the pipeline first.", { status: 404 });
  }
  const { note, aggregate, selectedQuotes } = pulse;
  const { markdown } = composeMarkdown(note, selectedQuotes, aggregate);
  const eml = buildEml(note, markdown);
  const filename = `groww-review-pulse-${note.weekLabel}.eml`;
  return new Response(eml, {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}