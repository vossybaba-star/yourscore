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
  question_count: number;
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

const ROMAN: Record<number, string> = { 2: "II", 3: "III", 4: "IV" };

function TopicCard({ topic, pack, challengeTo }: { topic: Topic; pack?: TopicPack & { volume?: number }; challengeTo: string | null }) {
  const emoji = TOPIC_EMOJI[topic.category] ?? "🎲";
  // A topic can render several cards (one per volume); the card shows the volume it is.
  const vol = pack?.volume ?? 1;
  const heading = vol > 1 ? `${topic.label} ${ROMAN[vol] ?? vol}` : topic.label;

  if (!pack) {
    return (
      <div
        className="rounded-3xl overflow-hidden px-4 py-5 flex flex-col items-center text-center"
        style={{
          background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          opacity: 0.45,
        }}
      >
        <span className="text-3xl mb-2">{emoji}</span>
        <p className="font-body text-sm font-bold text-white mb-1">{heading}</p>
        <p className="font-body text-xs leading-relaxed" style={{ color: "#7a857f" }}>
          Not enough verified questions yet for a full quiz. More are on the way.
        </p>
      </div>
    );
  }

  return (
    <Link
      href={withChallenge(`/challenges/${pack.slug}?pid=${pack.id}`, challengeTo)}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
        border: "1px solid rgba(0,216,192,0.18)",
      }}
    >
      <div className="px-4 py-5 flex flex-col items-center text-center">
        <span className="text-3xl mb-2">{emoji}</span>
        <p className="font-body text-sm font-bold text-white mb-1">{heading}</p>
        <p className="font-body text-xs mb-3" style={{ color: "#8a948f" }}>{pack.question_count} questions</p>
        <div
          className="rounded-xl py-1.5 px-3 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(255,120,0,0.12) 100%)",
            border: "1px solid rgba(0,216,192,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest text-teal">PLAY →</span>
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
      <div className="max-w-lg mx-auto px-4 pt-4">
        <BackPill fallback="/play" label="Back" tone="play" />
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

      {!loading && data && (
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

          <p className="font-body text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#586058" }}>
            Topics
          </p>
          <div className="grid grid-cols-2 gap-3">
            {data.topics.flatMap((topic) => {
              const volumes = topic.packs?.length ? topic.packs : (topic.pack ? [topic.pack] : []);
              // No pack at all: one disabled card carrying the honest reason.
              if (volumes.length === 0) {
                return [<TopicCard key={topic.category} topic={topic} challengeTo={challengeTo} />];
              }
              return volumes.map((p) => (
                <TopicCard key={p.id} topic={topic} pack={p} challengeTo={challengeTo} />
              ));
            })}
          </div>
        </div>
      )}

      {/* The club page is a hub, so it keeps the tab bar. BottomNav already treats /club as a
          Play route, but that highlight was dead until the bar was actually rendered here. */}
      <BottomNav />
    </div>
  );
}
