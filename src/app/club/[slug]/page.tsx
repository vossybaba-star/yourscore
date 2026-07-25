"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BackPill } from "@/components/ui/BackPill";
import { BottomNav } from "@/components/ui/BottomNav";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import { coverUrl } from "@/lib/img";

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
  question_count: number;
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

// ── Topic card ────────────────────────────────────────────────────────────

/**
 * ONE card per topic, always four cards. Rendering a card per volume looked fine at two
 * packs and broke down at eleven: Arsenal's page became four identical gold trophies in a
 * row with Legends, Modern Era and Rivalries pushed under two screens of scrolling. Depth
 * is a number on the card now, and the volumes live one tap away in a sheet.
 */
function TopicCard({
  topic, pack, count = 1, onOpenVolumes, challengeTo,
}: {
  topic: Topic;
  pack?: TopicPack & { volume?: number };
  count?: number;
  onOpenVolumes?: () => void;
  challengeTo: string | null;
}) {
  const emoji = TOPIC_EMOJI[topic.category] ?? "🎲";
  const heading = topic.label;
  const subLabel = count > 1 ? `${count} quizzes` : `${pack?.question_count ?? 15} questions`;

  // A topic with no pack is not rendered at all — the page only offers what it can deal.
  // The caller filters these out; this is a defensive guard, not a visible state.
  if (!pack) return null;

  const inner = (
    <div className="flex flex-col">
      {/* Poster art when it exists; the emoji is the fallback, never both. Covers are
          square (1080), CDN-resized via coverUrl so a grid never ships the original PNG. */}
      {pack?.cover_image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl(pack.cover_image, 220) ?? pack.cover_image} alt={heading}
          loading="lazy" decoding="async" className="block w-full h-auto" />
      ) : null}
      <div className="px-4 py-5 flex flex-col items-center text-center">
      {!pack?.cover_image && <span className="text-3xl mb-2">{emoji}</span>}
      <p className="font-body text-sm font-bold text-white mb-1">{heading}</p>
      <p className="font-body text-xs mb-3" style={{ color: "#8a948f" }}>{subLabel}</p>
      <div
        className="rounded-xl py-1.5 px-3 text-center"
        style={{
          background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(255,120,0,0.12) 100%)",
          border: "1px solid rgba(0,216,192,0.3)",
        }}
      >
        <span className="font-display text-xs tracking-widest text-teal">{count > 1 ? "CHOOSE →" : "PLAY →"}</span>
      </div>
      </div>
    </div>
  );

  const shell = "block w-full rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]";
  const shellStyle = {
    background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
    border: "1px solid rgba(0,216,192,0.18)",
  };

  // More than one quiz in this topic: pick which one, rather than guessing for them.
  if (count > 1) {
    return (
      <button type="button" onClick={onOpenVolumes} className={shell} style={shellStyle}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={withChallenge(`/challenges/${pack.slug}?pid=${pack.id}`, challengeTo)} className={shell} style={shellStyle}>
      {inner}
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
  // Which topic's volume list is open in the sheet (null = closed).
  const [sheetTopic, setSheetTopic] = useState<Topic | null>(null);

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

          {/* Only topics this club can actually deal. A card promising a quiz that does not
              exist is clutter, and with cover art on every card an empty one is worse. The
              heading goes too when nothing qualifies, rather than leaving a bare label. */}
          {availableTopics.length > 0 && (
          <>
          <p className="font-body text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#586058" }}>
            Topics
          </p>
          <div className="grid grid-cols-2 gap-3">
            {availableTopics.map(({ topic, volumes }) => (
              <TopicCard
                key={topic.category}
                topic={topic}
                pack={volumes[0]}
                count={volumes.length}
                onOpenVolumes={() => setSheetTopic(topic)}
                challengeTo={challengeTo}
              />
            ))}
          </div>
          </>
          )}
        </div>
      );
      })()}

      {/* Volume picker. Only reachable from a topic holding more than one quiz. */}
      {sheetTopic && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setSheetTopic(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl px-4 pt-3"
            style={{ background: "#080d0a", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />
            <p className="font-display text-base text-white text-center mb-1">
              {TOPIC_EMOJI[sheetTopic.category] ?? "🎲"} {sheetTopic.label}
            </p>
            <p className="font-body text-xs text-center mb-4" style={{ color: "#7a857f" }}>
              {(sheetTopic.packs ?? []).length} quizzes. Each one is a different set of questions.
            </p>
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pb-1">
              {(sheetTopic.packs ?? []).map((p, i) => (
                <Link
                  key={p.id}
                  href={withChallenge(`/challenges/${p.slug}?pid=${p.id}`, challengeTo)}
                  className="flex items-center justify-between rounded-2xl px-4 py-3.5 active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,216,192,0.2)" }}
                >
                  <span className="font-body text-sm font-bold text-white">Quiz {i + 1}</span>
                  <span className="font-body text-xs" style={{ color: "#8a948f" }}>{p.question_count} questions</span>
                </Link>
              ))}
            </div>
            <button
              onClick={() => setSheetTopic(null)}
              className="w-full mt-3 py-3 font-body"
              style={{ fontSize: 13, color: "#8a948f" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* The club page is a hub, so it keeps the tab bar. BottomNav already treats /club as a
          Play route, but that highlight was dead until the bar was actually rendered here. */}
      <BottomNav />
    </div>
  );
}
