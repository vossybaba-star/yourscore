"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BackPill } from "@/components/ui/BackPill";
import { BottomNav } from "@/components/ui/BottomNav";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";

// ── Types (mirrors the /api/club-page/[slug] response) ──────────────────────

interface SeasonPack {
  id: string;
  slug: string;
  name: string;
  question_count: number;
}

interface TopicPack {
  id: string;
  slug: string;
  name: string;
  /** Themed quiz title, derived from the pack's own questions. Null → volume label. */
  title?: string | null;
  question_count: number;
  volume?: number;
  /** Poster art (scripts/club-pages/gen-topic-covers.mjs). Null → emoji fallback. */
  cover_image?: string | null;
}

interface Topic {
  category: string;
  label: string;
  pack: TopicPack | null;
  /** Every volume for this topic (I, II, III…). One card is rendered per entry. */
  packs?: (TopicPack & { volume?: number })[];
}

interface ClubPageData {
  club: { name: string; slug: string };
  seasonPack: SeasonPack;
  topics: Topic[];
}

const TOPIC_EMOJI: Record<string, string> = {
  "history-honours": "🏆",
  legends: "⭐",
  "modern-era": "📅",
  "rivalries-derbies": "⚔️",
};

function withChallenge(href: string, challengeTo: string | null): string {
  return challengeTo ? `${href}${href.includes("?") ? "&" : "?"}challenge=${challengeTo}` : href;
}

// ── Season card ───────────────────────────────────────────────────────────

function SeasonCard({ club, pack, challengeTo }: { club: string; pack: SeasonPack; challengeTo: string | null }) {
  const badgeUrl = getTeamBadgeUrlSync(club);
  return (
    <Link
      href={withChallenge(`/challenges/${pack.slug}?pid=${pack.id}`, challengeTo)}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.98] mb-4"
      style={{
        background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
        border: "1px solid rgba(0,216,192,0.25)",
      }}
    >
      <div className="flex items-center gap-4 px-5 py-5">
        {badgeUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={badgeUrl}
            alt={club}
            width={56}
            height={56}
            style={{ objectFit: "contain", filter: "drop-shadow(0 4px 12px rgba(0,216,192,0.3))" }}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-display text-xs tracking-widest mb-1" style={{ color: "#00d8c0" }}>
            2025/26 SEASON REVIEW
          </p>
          <p className="font-body text-sm font-bold text-white leading-snug">{pack.name}</p>
          <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{pack.question_count} questions</p>
        </div>
        <span className="font-display text-xs px-3 py-2 rounded-xl flex-shrink-0"
          style={{ background: "#00d8c0", color: "#04231f" }}>
          PLAY
        </span>
      </div>
    </Link>
  );
}

// ── Quiz card (carousel item) ───────────────────────────────────────────────

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * One card per actual quiz pack, laid out in a horizontal per-category scroller.
 * Each pack carries its own themed `title` (derived from its questions); a volume
 * label is the fallback until the title backfill lands. The visual is the club
 * crest (all cards on a club page share it), so the card leads with the crest +
 * the quiz theme — no per-category poster art (founder call).
 */
function QuizCard({ pack, crestUrl, challengeTo }: { pack: TopicPack; crestUrl: string | null; challengeTo: string | null }) {
  const label = pack.title?.trim() || `Volume ${ROMAN[pack.volume ?? 1] ?? pack.volume ?? 1}`;
  return (
    <Link
      href={withChallenge(`/challenges/${pack.slug}?pid=${pack.id}`, challengeTo)}
      className="flex-shrink-0 rounded-2xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        width: 128,
        background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
        border: "1px solid rgba(0,216,192,0.18)",
      }}
    >
      <div className="flex items-center justify-center" style={{ height: 72, background: "radial-gradient(ellipse at 50% 75%, rgba(0,216,192,0.10) 0%, transparent 70%)" }}>
        {crestUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={crestUrl} alt="" width={40} height={40}
            style={{ objectFit: "contain", filter: "drop-shadow(0 3px 8px rgba(0,216,192,0.3))" }} />
        ) : (
          <span className="text-3xl">🎲</span>
        )}
      </div>
      <div className="px-2 pt-1.5 pb-2">
        <p className="font-body text-[13px] font-bold text-white leading-tight line-clamp-2" style={{ minHeight: 32 }}>{label}</p>
        <p className="font-body text-[10px] mt-0.5 mb-1.5" style={{ color: "#8a948f" }}>{pack.question_count} questions</p>
        <div
          className="rounded-md py-1 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(255,120,0,0.12) 100%)",
            border: "1px solid rgba(0,216,192,0.3)",
          }}
        >
          <span className="font-display text-[10px] tracking-wide text-teal">PLAY →</span>
        </div>
      </div>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ClubPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const challengeTo = searchParams?.get("challenge") ?? null;

  const [data, setData] = useState<ClubPageData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/club-page/${slug}`)
      .then(async (r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (json) setData(json as ClubPageData);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    // 72px of bottom padding, not 48: the tab bar is rendered on this page (it is a hub, not a
    // terminal screen), so the last row of topic cards has to clear it.
    <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
      {/* pt-safe: /club has no GamesNav above it, so the pill sits at the very top of
          the viewport — without the safe-area inset it lands under the iOS status bar /
          Dynamic Island and can't be tapped (founder report, back button unclickable). */}
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4">
          <BackPill fallback="/play" label="Back" tone="play" />
        </div>
      </div>

      {loading && (
        <div className="max-w-lg mx-auto px-4 pt-10">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-3xl bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.06)", height: 160, opacity: 0.3 }} />
            ))}
          </div>
        </div>
      )}

      {!loading && notFound && (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <p className="text-4xl mb-4">🏟️</p>
          <p className="font-body text-sm text-text-muted">Couldn&apos;t find that club.</p>
        </div>
      )}

      {!loading && data && (() => {
      // Topics this club can actually deal, paired with their volumes. Everything else is
      // dropped before render, so no card ever promises a quiz that does not exist.
      const availableTopics = data.topics
        .map((topic) => ({
          topic,
          volumes: topic.packs?.length ? topic.packs : (topic.pack ? [topic.pack] : []),
        }))
        .filter(({ volumes }) => volumes.length > 0);
      return (
        <div className="max-w-lg mx-auto px-4 pt-4">
          {/* Hero */}
          <div className="flex flex-col items-center text-center mb-6">
            {getTeamBadgeUrlSync(data.club.name) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getTeamBadgeUrlSync(data.club.name)!}
                alt={data.club.name}
                width={84}
                height={84}
                style={{ objectFit: "contain", filter: "drop-shadow(0 6px 16px rgba(0,216,192,0.35))" }}
                className="mb-3"
              />
            )}
            <h1 className="font-display text-2xl tracking-tight text-white">{data.club.name}</h1>
            <p className="font-body text-xs mt-1" style={{ color: "#8a948f" }}>Test your football knowledge</p>
          </div>

          <SeasonCard club={data.club.name} pack={data.seasonPack} challengeTo={challengeTo} />

          {/* One section per category the club can actually deal — a header plus a
              horizontal scroller of the real quizzes in that category. Categories with
              no packs are dropped, so no section ever promises a quiz that doesn't exist. */}
          {availableTopics.map(({ topic, volumes }) => (
            <section key={topic.category} className="mb-6">
              <p className="font-body text-xs font-bold uppercase tracking-widest mb-2.5" style={{ color: "#8a948f" }}>
                <span className="mr-1">{TOPIC_EMOJI[topic.category] ?? "🎲"}</span>{topic.label}
              </p>
              {/* -mx-4 px-4 lets the row bleed to the screen edges so a card can peek past
                  the fold, signalling "scroll for more". */}
              <div className="flex gap-2.5 overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: "none" }}>
                {volumes.map((p) => (
                  <QuizCard key={p.id} pack={p} crestUrl={getTeamBadgeUrlSync(data.club.name)} challengeTo={challengeTo} />
                ))}
              </div>
            </section>
          ))}
        </div>
      );
      })()}

      {/* The club page is a hub, so it keeps the tab bar. BottomNav already treats /club as a
          Play route, but that highlight was dead until the bar was actually rendered here. */}
      <BottomNav />
    </div>
  );
}
