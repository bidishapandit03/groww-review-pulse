import type { Metadata } from "next";
import { mailtoUrl } from "@/lib/pipeline/email";
import { composeMarkdown, formatWow, themeLabel } from "@/lib/pipeline/note";
import { loadPulse } from "@/lib/pipeline/pulse";
import type { CandidateQuote } from "@/lib/pipeline/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Groww Review Pulse — Weekly",
};

function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= value ? "starOn" : "starOff"}>
          ★
        </span>
      ))}
    </span>
  );
}

function WowBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="chip chipGray">WoW —</span>;
  const label = formatWow(delta);
  if (delta > 0) return <span className="chip wowUp">↑ WoW {label}</span>;
  return <span className="chip wowDown">↓ WoW {label}</span>;
}

function storeName(source: string): string {
  return source === "appstore" ? "App Store" : "Play Store";
}

function QuoteCard({ quote }: { quote: CandidateQuote }) {
  return (
    <div className="quoteCard">
      <div className="quoteMark">{'"'}</div>
      <p className="quoteText">{quote.text}</p>
      <div className="quoteFoot">
        <Stars value={quote.rating} />
        <span className="storeChip">{storeName(quote.source)}</span>
      </div>
    </div>
  );
}

export default async function Home() {
  const pulse = await loadPulse();

  if (!pulse) {
    return (
      <main className="page">
        <section className="empty">
          <div className="ring">{"G"}</div>
          <h2>No pulse yet</h2>
          <p>
            The weekly pipeline hasn&apos;t produced a note. Run the pipeline and the
            latest review pulse will appear here.
          </p>
        </section>
      </main>
    );
  }

  const { note, aggregate: agg, selectedQuotes, demo } = pulse;
  const weekShort = note.weekLabel.split("W")[1] ?? note.weekLabel;

  const { markdown } = composeMarkdown(note, selectedQuotes, agg);
  const mailto = mailtoUrl(note, undefined, markdown);

  const themeStats = (id: string) => agg.tagged.find((t) => t.theme === id);
  const wowDelta = (id: string) => agg.wow.find((w) => w.theme === id)?.delta ?? null;

  return (
    <main>
      <header className="topbar">
        <div className="topbarInner">
          <div className="brand">
            <div className="brandMark">{"G"}</div>
            <div className="brandName">
              Groww<span>Review Pulse</span>
            </div>
          </div>
          <div className="weekChip">Week {weekShort}</div>
        </div>
      </header>

      <div className="page">
        <section className="hero">
          <div className="eyebrow">Weekly review pulse</div>
          <h1>What users are telling you</h1>
          <p className="sub">
            {agg.totalReviews} reviews from the public App Store &amp; Play Store over the
            last {agg.windowWeeks} weeks, ranked by impact. Stats are computed in code;
            quotes are verbatim and redacted.
          </p>
          <div className="statRow">
            <div className="statCard">
              <div className="statValue">{agg.totalReviews}</div>
              <div className="statLabel">Reviews</div>
            </div>
            <div className="statCard">
              <div className="statValue">
                {agg.averageRating.toFixed(1)} <Stars value={Math.round(agg.averageRating)} />
              </div>
              <div className="statLabel">Avg rating</div>
            </div>
            <div className="statCard">
              <div className="statValue">{agg.windowWeeks}w</div>
              <div className="statLabel">Window</div>
            </div>
          </div>
        </section>

        <section>
          <div className="sectionHead">
            <h2 className="sectionTitle">Top themes</h2>
            <span className="sectionHint">impact = volume + negativity + momentum</span>
          </div>
          <div className="themeList">
            {note.themes.map((t, i) => {
              const s = themeStats(t.theme);
              return (
                <div className="themeCard" key={t.theme}>
                  <div className="themeTop">
                    <div className="themeLabel">
                      <span style={{ color: "var(--brand-deep)", fontWeight: 800, marginRight: 8 }}>
                        {i + 1}
                      </span>
                      {themeLabel(t.theme)}
                    </div>
                    <div className="themeStats">
                      <span className="chip chipGray">{s?.count ?? 0} revs</span>
                      <span className="chip chipGray">avg {s?.avgRating.toFixed(1) ?? "—"}★</span>
                      <WowBadge delta={wowDelta(t.theme)} />
                    </div>
                  </div>
                  <p>{t.summary}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="sectionHead">
            <h2 className="sectionTitle">Voices</h2>
            <span className="sectionHint">verbatim user words</span>
          </div>
          <div className="quoteList">
            {selectedQuotes.map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
        </section>

        <section>
          <div className="sectionHead">
            <h2 className="sectionTitle">Actions for the week</h2>
            <span className="sectionHint">owner · metric</span>
          </div>
          <div className="actionList">
            {note.actions.map((a, i) => (
              <div className="actionRow" key={i}>
                <div className="actionNum">{i + 1}</div>
                <div className="actionBody">
                  <span className="ownerChip">{a.owner}</span>
                  <span className="text">{a.action}</span>
                  <span className="metric">
                    watch: <b>{a.metric}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mailSection">
          <p className="mailHint">
            Share this pulse with the team — your mail app opens pre-filled with the
            recap, or grab it as a .eml draft.
          </p>
          <div className="mailbar">
            <a className="btnSend" href={mailto}>
              Send this recap
            </a>
            <a className="btnGhost" href="/api/email" download>
              Download .eml
            </a>
          </div>
        </section>

        <footer className="footer">
          <span className="demoChip">
            {demo ? "Demo data — run the pipeline for the live note" : "Live pipeline output"}
          </span>
          <span>
            Every count, average and trend is computed in code. Quotes come from public
            store reviews and are always redacted — no PII, no raw reviews, ever.
          </span>
        </footer>
      </div>
    </main>
  );
}