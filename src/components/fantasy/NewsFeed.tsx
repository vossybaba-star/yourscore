"use client";
/**
 * The fantasy news feed stream — filter chips + content cards.
 *
 * Client component (the chips hold state) fed entirely by server-rendered props,
 * so /fantasy/news stays ISR: no client fetch, no waterfall, no spinner.
 *
 * Design notes:
 * - IMAGES are the point. A feed of grey text blocks reads as unfinished no
 *   matter how good the words are; a journalist's photo is what makes it feel
 *   like football. Tweets and articles both carry one when the source has one.
 * - Cards, but ONE level deep and never nested. Each card is a whole tap target.
 * - Gold is reserved for state and the one thing that tells you what to DO
 *   (the tip). If everything is gold, nothing is.
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NewsDoubt, NewsInsight, NewsItem, NewsTips } from "@/lib/fantasy/news";
import { useShortlist } from "@/components/fantasy/useShortlist";
import {
  buildRelevanceLookup, type PoolIdentity, type Relevance,
} from "@/lib/fantasy/scoutRelevance";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { NewsSheet, type SheetStory } from "@/components/news/NewsSheet";
import { faceFor, faceUrlById } from "@/lib/fantasy/faces";
import { clubBadgeInText } from "@/lib/teamImages";

/** Normalise a name for surname matching: strip accents/punctuation, lowercase. */
function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

// Shared fantasy tokens (mirrored, not imported — shared.tsx is "use client").
const GOLD = "#ffc233";
const TEAL = "#00d8c0";
const PANEL = "#0e1611";
const LINE = "rgba(255,255,255,0.07)";
const INK = "#eef2f0";
const MUTED = "#8a948f";
const CORAL = "#e0653c";
const AMBER = "#f4a63a";

// ── Scout Report tags ─────────────────────────────────────────────────────────

/** How a card touches THIS reader. Text always present — colour never carries the
 *  meaning alone. gold = shortlist, teal = your squad (structure), muted = a
 *  general league item. */
function RelevanceTag({ rel }: { rel: Relevance }) {
  const map: Record<Relevance, { text: string; color: string }> = {
    squad: { text: "In your squad", color: TEAL },
    shortlist: { text: "On your shortlist", color: GOLD },
    league: { text: "League update", color: MUTED },
  };
  const { text, color } = map[rel];
  const plain = rel === "league";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.03em", padding: "2px 7px", borderRadius: 999,
      whiteSpace: "nowrap", color, background: plain ? "transparent" : `${color}1e`,
      border: `1px solid ${plain ? LINE : `${color}55`}`,
    }}>{text}</span>
  );
}

/** Confirmed vs Reported. Only ever "Reported" today — the one confirmation
 *  level the feed data genuinely distinguishes is that a predicted-XI diff is a
 *  PREDICTION, not a confirmed fact (news.ts). Amber = reported/doubt; teal would
 *  mean confirmed. Reported info must never wear the certainty of confirmed. */
function ConfirmationTag({ level }: { level: "reported" | "confirmed" }) {
  const confirmed = level === "confirmed";
  const color = confirmed ? TEAL : AMBER;
  return (
    <span title={confirmed ? "Confirmed" : "Reported, not confirmed"}
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.03em", padding: "2px 7px", borderRadius: 999,
        whiteSpace: "nowrap", color, background: `${color}1e`, border: `1px solid ${color}55`,
      }}>{confirmed ? "Confirmed" : "Reported"}</span>
  );
}

function TagRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>{children}</div>
  );
}

/**
 * One editorial card — a named format (Captaincy Call, The Differential, Fixture
 * Swing, The Risk, Worth Knowing) rather than a wall of text. Eyebrow label in
 * the format's colour, then the subject and a one-line read. Every card is built
 * from a real field; nothing here is invented.
 */
function EditorialCard({
  label, accent, heading, sub, body, tags, faceUrl, faceName, crestClub,
}: {
  label: string; accent: string; heading: string; sub?: string; body: string;
  tags?: React.ReactNode;
  /** When the card is about one player, their headshot sits beside the heading. */
  faceUrl?: string | null; faceName?: string;
  /** When the card is about a club (a fixture run), its crest sits there instead. */
  crestClub?: string;
}) {
  return (
    <section style={{ background: PANEL, border: `1px solid ${accent}55`, borderRadius: 12, padding: 13 }}>
      {tags && <TagRow>{tags}</TagRow>}
      <div className="font-display" style={{ color: accent, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em", marginBottom: 7 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {faceName ? (
          <PlayerAvatar name={faceName} avatarUrl={faceUrl ?? faceFor(faceName)} size={38} />
        ) : crestClub ? (
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: "rgba(255,255,255,0.05)", border: `1px solid ${LINE}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Crest club={crestClub} size={28} />
          </div>
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: INK, fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>
            {heading}{sub && <span style={{ color: MUTED, fontWeight: 400, fontSize: 12.5 }}>  {sub}</span>}
          </div>
        </div>
      </div>
      <p style={{ color: INK, fontSize: 13.5, margin: "7px 0 0", lineHeight: 1.5 }}>{body}</p>
    </section>
  );
}

type Filter = "all" | "team-news" | "transfers" | "tips";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tips", label: "Tips" },
  { id: "team-news", label: "Team news" },
  { id: "transfers", label: "Transfers" },
];

/** "Drafted Tue 14:00" — tips can be re-drafted mid-week (a doubt naming the
 *  tipped player forces it), so this is what makes staleness honest: even when
 *  a redraft attempt fails and the previous pick is left standing, the reader
 *  can see it wasn't written today. */
function draftedLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  const time = d.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  return `Drafted ${day} ${time}`;
}

/** "2h ago" — a feed without timestamps doesn't read as news. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const cardBase: CSSProperties = {
  background: PANEL,
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  overflow: "hidden",
  display: "block",
  textDecoration: "none",
  WebkitTapHighlightColor: "transparent",
};

function Thumb({ src, alt }: { src: string; alt: string }) {
  return (
    <div style={{ aspectRatio: "16 / 9", background: "#080d0a", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

/**
 * One article or tweet.
 *
 * It no longer links out. Tapping opens the shared NewsSheet over the feed —
 * same half-view the PL news feed uses — so the reader gets the gist without
 * being dumped onto someone else's site, and leaving is a deliberate second tap.
 */
function ItemCard({ item, rel, onOpen, faceUrl, faceName, crestUrl }: {
  item: NewsItem; rel?: Relevance; onOpen: () => void;
  /** When the source carries no photo, the matched player's face fills the gap so
   *  no card is a bare block of text (the whole point of this feed). A club crest
   *  is the next fallback, for manager/club news that names no single player. */
  faceUrl?: string | null; faceName?: string; crestUrl?: string | null;
}) {
  const p = item.payload;
  const isTweet = item.kind === "tweet";
  const showFace = !p.image && !!faceUrl;
  const showCrest = !p.image && !faceUrl && !!crestUrl;
  return (
    <button type="button" onClick={onOpen}
      style={{ ...cardBase, width: "100%", textAlign: "left", padding: 0, cursor: "pointer" }}
      className="ys-card">
      {p.image && <Thumb src={p.image} alt="" />}
      <div style={{ padding: 12 }}>
        {rel && <TagRow><RelevanceTag rel={rel} /></TagRow>}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {showFace && (
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              <PlayerAvatar name={faceName ?? ""} avatarUrl={faceUrl} size={44} />
            </div>
          )}
          {showCrest && (
            <div style={{
              flexShrink: 0, marginTop: 1, width: 44, height: 44, borderRadius: 12,
              background: "rgba(255,255,255,0.05)", border: `1px solid ${LINE}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={crestUrl ?? ""} alt="" width={32} height={32} style={{ objectFit: "contain" }} />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 6, marginBottom: 5,
                fontSize: 11, color: MUTED,
              }}
            >
              <span style={{ color: isTweet ? GOLD : MUTED, fontWeight: 600 }}>
                {isTweet ? p.handle : p.source}
              </span>
              {isTweet && p.verified === "true" && (
                <span aria-hidden="true" style={{ color: "#4FA8E0", fontSize: 12, lineHeight: 1 }}>✓</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{ago(item.createdAt)}</span>
            </div>
            <div style={{ color: INK, fontSize: 14, lineHeight: 1.45, fontWeight: isTweet ? 400 : 600 }}>
              {isTweet ? p.text : p.title}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/** A feed item in the shape the shared sheet reads. A tweet is body copy, not a
 *  headline, and keeps the gold that marks it as a tweet everywhere else. */
function toStory(item: NewsItem, i: number): SheetStory {
  const p = item.payload;
  const isTweet = item.kind === "tweet";
  return {
    id: `${item.createdAt}-${i}`,
    title: (isTweet ? p.text : p.title) ?? "",
    url: p.url ?? "",
    source: (isTweet ? p.handle : p.source) ?? "",
    timeLabel: ago(item.createdAt),
    image: p.image ?? null,
    summary: isTweet ? undefined : p.summary,
    accent: isTweet ? GOLD : TEAL,
    readLabel: isTweet ? "Read on X" : "Read the full story",
    bodyStyle: isTweet ? "quote" : "headline",
  };
}

export function NewsFeed({
  tips, doubts, insights, teamItems, transferItems,
}: {
  tips?: NewsTips;
  doubts: NewsDoubt[];
  insights: NewsInsight[];
  teamItems: NewsItem[];
  transferItems: NewsItem[];
}) {
  const [filter, setFilter] = useState<Filter>("all");

  // Which section the open sheet is walking. Tracked per section rather than
  // over one merged list so swiping up stays inside the section you tapped —
  // sliding from team news into transfers mid-swipe reads as a bug.
  const [open, setOpen] = useState<{ section: "team" | "transfers"; index: number } | null>(null);
  const teamStories = useMemo(() => teamItems.map(toStory), [teamItems]);
  const transferStories = useMemo(() => transferItems.map(toStory), [transferItems]);
  const openStories = open?.section === "team" ? teamStories : transferStories;

  // ── Personalisation layer: one central feed, labelled per reader ──────────
  // Fetched client-side so the page stays a server component (ISR). All three
  // reads degrade to nothing — a guest (state 401s) or a failed pool fetch just
  // means every card reads "League update", never a wrong squad/shortlist claim.
  const [pool, setPool] = useState<PoolIdentity[] | null>(null);
  const [squadIds, setSquadIds] = useState<number[]>([]);
  const shortlist = useShortlist();

  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/pool", { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { players?: PoolIdentity[] } | null) => { if (live && d?.players) setPool(d.players); })
      .catch(() => {});
    fetch("/api/fantasy/state", { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { squad?: { picks?: { id: number }[] } | null } | null) => {
        if (live && s?.squad?.picks) setSquadIds(s.squad.picks.map((p) => p.id));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const rel = useMemo(
    () => buildRelevanceLookup(pool, squadIds, shortlist.ids),
    [pool, squadIds, shortlist.ids],
  );

  // Resolve a card's player name to a real headshot, by surname against the pool.
  // Single confident match only — two players share a surname, so an ambiguous
  // match returns null and the card draws the monogram rather than a wrong face.
  const facer = useMemo(() => {
    const bySurname = new Map<string, PoolIdentity[]>();
    for (const p of pool ?? []) {
      const parts = p.name.trim().split(/\s+/);
      const sn = normName(parts[parts.length - 1] ?? "");
      if (!sn) continue;
      const list = bySurname.get(sn); if (list) list.push(p); else bySurname.set(sn, [p]);
    }
    const single = (sn: string): PoolIdentity | null => {
      const m = sn ? bySurname.get(sn) ?? [] : [];
      return m.length === 1 ? m[0] : null;
    };
    return {
      // The subject's face, matched on the LAST word as a surname — for a card
      // that IS a player (a tip's captain pick).
      byName: (display: string): string | null => {
        const parts = display.trim().split(/[\s.]+/).filter(Boolean);
        const m = single(normName(parts[parts.length - 1] ?? ""));
        return m ? faceUrlById(m.id) ?? null : null;
      },
      // A face for a freeform headline: scan every word, first confident single
      // surname match wins. So "Saka back in training" finds Saka. Short tokens
      // are skipped to avoid matching stray words.
      inText: (text: string): PoolIdentity | null => {
        for (const w of text.split(/[\s.,'"’()]+/)) {
          const sn = normName(w);
          if (sn.length < 3) continue;
          const m = single(sn);
          if (m) return m;
        }
        return null;
      },
    };
  }, [pool]);

  const hasTips = !!(tips?.captain || tips?.differential || tips?.note);
  const show = useMemo(
    () => ({
      tips: hasTips && (filter === "all" || filter === "tips"),
      insights: insights.length > 0 && (filter === "all" || filter === "tips"),
      doubts: doubts.length > 0 && (filter === "all" || filter === "team-news"),
      team: teamItems.length > 0 && (filter === "all" || filter === "team-news"),
      transfers: transferItems.length > 0 && (filter === "all" || filter === "transfers"),
    }),
    [filter, hasTips, insights.length, doubts.length, teamItems.length, transferItems.length],
  );
  const nothing = !Object.values(show).some(Boolean);

  return (
    <>
      <style>{`
        .ys-chip { transition: background 160ms cubic-bezier(.22,1,.36,1), color 160ms; }
        .ys-card { transition: border-color 160ms cubic-bezier(.22,1,.36,1); }
        @media (hover: hover) { .ys-card:hover { border-color: ${GOLD}55; } }
        .ys-card:active { border-color: ${GOLD}88; }
        @media (prefers-reduced-motion: reduce) {
          .ys-chip, .ys-card { transition: none; }
        }
      `}</style>

      {/* Filter chips — the feed's one interaction. Scannable, thumb-sized. */}
      <div
        role="tablist"
        aria-label="Filter the feed"
        style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}
      >
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.id)}
              className="ys-chip"
              style={{
                flex: "0 0 auto",
                padding: "7px 14px",
                minHeight: 34,
                borderRadius: 999,
                border: `1px solid ${on ? GOLD : LINE}`,
                background: on ? GOLD : "transparent",
                color: on ? "#0a0a0f" : MUTED,
                fontSize: 12.5,
                fontWeight: on ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {nothing && (
        <div style={{ ...cardBase, padding: 16 }}>
          <div style={{ color: INK, fontSize: 14, fontWeight: 600 }}>Nothing here yet</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            {filter === "all"
              ? "Team news, transfer talk and tips land here as the gameweek builds."
              : "Try another filter. There's news in the other tabs."}
          </div>
        </div>
      )}

      {/* THE ANALYSIS — named editorial formats, the accented top slot. Each is
          one real field: the LLM-grounded tips, the form/fixture insights. */}
      {show.tips && tips?.captain && (
        <EditorialCard label="CAPTAINCY CALL" accent={GOLD}
          heading={tips.captain.player} body={tips.captain.why}
          faceName={tips.captain.player} faceUrl={facer.byName(tips.captain.player)}
          tags={rel.ready && <RelevanceTag rel={rel.forName(tips.captain.player)} />} />
      )}
      {show.tips && tips?.differential && (
        <EditorialCard label="THE DIFFERENTIAL" accent={TEAL}
          heading={tips.differential.player} body={tips.differential.why}
          faceName={tips.differential.player} faceUrl={facer.byName(tips.differential.player)}
          tags={rel.ready && <RelevanceTag rel={rel.forName(tips.differential.player)} />} />
      )}
      {show.insights && insights.filter((n) => n.kind === "fixture-swing").map((n, i) => (
        <EditorialCard key={`sw${i}`} label="FIXTURE SWING" accent={TEAL} heading={n.title} body={n.body}
          crestClub={n.club}
          tags={rel.ready && <RelevanceTag rel={rel.forText(`${n.title} ${n.body}`)} />} />
      ))}
      {show.insights && insights.filter((n) => n.kind === "form").map((n, i) => (
        <EditorialCard key={`fm${i}`} label="WORTH KNOWING" accent={MUTED} heading={n.title} body={n.body}
          faceName={n.playerName} faceUrl={n.playerId != null ? faceUrlById(n.playerId) : undefined}
          tags={rel.ready && <RelevanceTag rel={rel.forText(`${n.title} ${n.body}`)} />} />
      ))}
      {show.tips && (tips?.note || tips?.draftedAt) && (
        <div style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, padding: "0 2px" }}>
          {tips?.note}
          {tips?.draftedAt && <div style={{ marginTop: tips?.note ? 6 : 0 }}>{draftedLabel(tips.draftedAt)}</div>}
        </div>
      )}

      {/* THE RISK — a flagged doubt is a risk to plan around, in the same format.
          A predicted-XI diff is REPORTED, not confirmed — the tag says so, so it
          never reads with the certainty of a confirmed injury. */}
      {show.doubts && doubts.map((d) => (
        <EditorialCard key={d.smId} label="THE RISK" accent={CORAL}
          heading={d.name} sub={`(${d.club})`} body={d.reason}
          faceName={d.name} faceUrl={facer.byName(d.name)}
          tags={<>
            {rel.ready && <RelevanceTag rel={rel.forName(d.name)} />}
            <ConfirmationTag level="reported" />
          </>} />
      ))}

      {show.team && (
        <section style={{ display: "grid", gap: 10 }}>
          <h2 style={{ color: INK, fontSize: 13, fontWeight: 600, margin: 0 }}>Team news</h2>
          {teamItems.map((it, i) => {
            const txt = `${it.payload.title ?? ""} ${it.payload.text ?? ""}`;
            const m = facer.inText(txt);
            return (
              <ItemCard key={`t${i}`} item={it} onOpen={() => setOpen({ section: "team", index: i })}
                rel={rel.ready ? rel.forText(txt) : undefined}
                faceUrl={m ? faceUrlById(m.id) : null} faceName={m?.name}
                crestUrl={m ? null : clubBadgeInText(txt)} />
            );
          })}
        </section>
      )}

      {show.transfers && (
        <section style={{ display: "grid", gap: 10 }}>
          <h2 style={{ color: INK, fontSize: 13, fontWeight: 600, margin: 0 }}>Transfers &amp; talk</h2>
          {transferItems.map((it, i) => {
            const txt = `${it.payload.title ?? ""} ${it.payload.text ?? ""}`;
            const m = facer.inText(txt);
            return (
              <ItemCard key={`x${i}`} item={it} onOpen={() => setOpen({ section: "transfers", index: i })}
                rel={rel.ready ? rel.forText(txt) : undefined}
                faceUrl={m ? faceUrlById(m.id) : null} faceName={m?.name}
                crestUrl={m ? null : clubBadgeInText(txt)} />
            );
          })}
        </section>
      )}

      {open && openStories[open.index] && (
        <NewsSheet
          stories={openStories}
          index={open.index}
          onIndexChange={(index) => setOpen({ section: open.section, index })}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
