"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/ui/BottomNav";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { slugify } from "@/lib/utils";
import { RECORDS_EMOJI } from "@/lib/theme";

interface QuizPack {
  id: string;
  name: string;
  type: string;
  parameter: string;
  question_count: number;
  status: string;
  description?: string | null;
  featured?: boolean;
  featured_order?: number | null;
  metadata?: { icon?: string } | null;
}

const END_OF_SEASON_EMOJI: Record<string, string> = {
  "The Farewell Tour": "👋",
};

function ClubCard({ pack }: { pack: QuizPack }) {
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);

  useEffect(() => {
    getTeamBadgeUrl(pack.name).then((u) => { if (u) setBadgeUrl(u); });
  }, [pack.name]);

  return (
    <Link
      href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #161624 0%, #1c1a2e 100%)",
        border: "1px solid rgba(255,184,0,0.18)",
      }}
    >
      {/* Badge zone */}
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 110,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(255,184,0,0.12) 0%, transparent 70%), linear-gradient(180deg, rgba(255,184,0,0.05) 0%, transparent 100%)",
        }}
      >
        {badgeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={badgeUrl}
            alt={pack.name}
            width={68}
            height={68}
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 6px 16px rgba(255,184,0,0.35))",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-2xl font-display text-3xl text-white"
            style={{ width: 68, height: 68, background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.2)" }}
          >
            {pack.name[0]}
          </div>
        )}
        {/* Q count chip */}
        <div
          className="absolute top-3 right-3 font-display text-xs px-2 py-0.5 rounded-lg text-amber"
          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,184,0,0.3)" }}
        >
          {pack.question_count}Q
        </div>
      </div>

      {/* Text + CTA */}
      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-tight mb-0.5 truncate">{pack.name}</p>
        <p className="font-body text-xs mb-1.5" style={{ color: "#7777aa" }}>2025/26 Season Game</p>
        {pack.description && (
          <p className="font-body text-xs mb-2.5 line-clamp-2 leading-relaxed" style={{ color: "#9999bb" }}>{pack.description}</p>
        )}
        <div
          className="rounded-xl py-2 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(255,184,0,0.18) 0%, rgba(255,120,0,0.12) 100%)",
            border: "1px solid rgba(255,184,0,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest text-amber">
            PLAY NOW →
          </span>
        </div>
      </div>
    </Link>
  );
}

function RecordsCard({ pack }: { pack: QuizPack }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);
  const emoji = pack.metadata?.icon ?? RECORDS_EMOJI[pack.name] ?? null;

  useEffect(() => {
    getCompetitionBadgeUrl(pack.name).then((u) => { if (u) setLogoUrl(u); });
  }, [pack.name]);

  return (
    <Link
      href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #12101e 0%, #1a1430 100%)",
        border: "1px solid rgba(167,139,250,0.2)",
      }}
    >
      {/* Badge zone */}
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 110,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(167,139,250,0.14) 0%, transparent 70%), linear-gradient(180deg, rgba(167,139,250,0.06) 0%, transparent 100%)",
        }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={pack.name}
            width={64}
            height={64}
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 6px 16px rgba(167,139,250,0.45))",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <span className="text-5xl" style={{ filter: "drop-shadow(0 4px 12px rgba(167,139,250,0.4))" }}>
            {emoji ?? "📊"}
          </span>
        )}
        <div
          className="absolute top-3 right-3 font-display text-xs px-2 py-0.5 rounded-lg"
          style={{ background: "rgba(0,0,0,0.5)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}
        >
          {pack.question_count}Q
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-tight mb-0.5">{pack.name}</p>
        <p className="font-body text-xs mb-1.5" style={{ color: "#7777aa" }}>All-Time Records</p>
        {pack.description && (
          <p className="font-body text-xs mb-2.5 line-clamp-2 leading-relaxed" style={{ color: "#9999bb" }}>{pack.description}</p>
        )}
        <div
          className="rounded-xl py-2 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(167,139,250,0.18) 0%, rgba(124,58,237,0.12) 100%)",
            border: "1px solid rgba(167,139,250,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest" style={{ color: "#a78bfa" }}>
            PLAY NOW →
          </span>
        </div>
      </div>
    </Link>
  );
}

function EndOfSeasonCard({ pack }: { pack: QuizPack }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const slug = slugify(pack.name);
  const emoji = END_OF_SEASON_EMOJI[pack.name] ?? null;

  useEffect(() => {
    // "Arsenal Are Champions" uses the team badge; others use competition badges
    if (pack.name === "Arsenal Are Champions") {
      getTeamBadgeUrl("Arsenal").then((u) => { if (u) setImageUrl(u); });
    } else {
      getCompetitionBadgeUrl(pack.name).then((u) => { if (u) setImageUrl(u); });
    }
  }, [pack.name]);

  return (
    <Link
      href={`/challenges/${slug}`}
      className="block rounded-3xl overflow-hidden transition-all duration-150 active:scale-[0.96]"
      style={{
        background: "linear-gradient(160deg, #0f1f1e 0%, #0a1a24 100%)",
        border: "1px solid rgba(34,211,238,0.2)",
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          height: 110,
          background:
            "radial-gradient(ellipse at 50% 80%, rgba(34,211,238,0.14) 0%, transparent 70%), linear-gradient(180deg, rgba(34,211,238,0.06) 0%, transparent 100%)",
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={pack.name}
            width={64}
            height={64}
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 6px 16px rgba(34,211,238,0.45))",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <span className="text-5xl" style={{ filter: "drop-shadow(0 4px 12px rgba(34,211,238,0.4))" }}>
            {emoji ?? "🏁"}
          </span>
        )}
        <div
          className="absolute top-3 right-3 font-display text-xs px-2 py-0.5 rounded-lg"
          style={{ background: "rgba(0,0,0,0.5)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}
        >
          {pack.question_count}Q
        </div>
        <div
          className="absolute top-3 left-3 font-body text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}
        >
          25/26
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-tight mb-0.5">{pack.name}</p>
        <p className="font-body text-xs mb-1.5" style={{ color: "#7777aa" }}>End of Season</p>
        {pack.description && (
          <p className="font-body text-xs mb-2.5 line-clamp-2 leading-relaxed" style={{ color: "#9999bb" }}>{pack.description}</p>
        )}
        <div
          className="rounded-xl py-2 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(34,211,238,0.18) 0%, rgba(6,182,212,0.12) 100%)",
            border: "1px solid rgba(34,211,238,0.3)",
          }}
        >
          <span className="font-display text-xs tracking-widest" style={{ color: "#22d3ee" }}>
            PLAY NOW →
          </span>
        </div>
      </div>
    </Link>
  );
}

type ActiveTab = "club" | "records" | "featured";

export default function ChallengesPage() {
  const [packs, setPacks] = useState<QuizPack[]>([]);
  const [activeType, setActiveType] = useState<ActiveTab>("featured");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    createClient()
      .from("quiz_packs")
      .select("id, name, type, parameter, question_count, status, description, featured, featured_order, metadata")
      .eq("status", "published")
      .order("name")
      .then(({ data }) => {
        setPacks((data ?? []) as unknown as QuizPack[]);
        setLoading(false);
      });
  }, []);

  const featuredPacks = packs
    .filter((p) => p.featured)
    .sort((a, b) => (a.featured_order ?? 99) - (b.featured_order ?? 99));
  const endOfSeasonPacks = packs.filter(
    (p) => p.parameter === "2025/26 End of Season" && !p.featured
  );
  // Featured tab: the curated featured packs first, then the end-of-season packs.
  const featuredTabPacks = [...featuredPacks, ...endOfSeasonPacks];
  const filtered =
    activeType === "featured"
      ? featuredTabPacks
      : activeType === "records"
      ? packs.filter((p) => p.type === "records" && p.parameter !== "2025/26 End of Season" && !p.featured)
      : packs.filter((p) => p.type === "club");

  const clubCount = packs.filter((p) => p.type === "club").length;
  const recordsCount = packs.filter((p) => p.type === "records" && p.parameter !== "2025/26 End of Season" && !p.featured).length;
  const featuredCount = featuredTabPacks.length;
  const router = useRouter();

  return (
    <div
      className="min-h-screen bg-bg"
      style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}
    >
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 pt-safe"
        style={{
          background: "rgba(10,10,15,0.97)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-lg mx-auto px-5 pt-3 pb-3">
          {/* Title row */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-display text-2xl tracking-tight text-amber">
                CHALLENGES
              </h1>
              <p className="font-body text-xs mt-0.5 text-text-muted">
                Test your football knowledge
              </p>
            </div>
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.2)" }}
            >
              <span className="text-xs">⚡</span>
              <span className="font-display text-xs text-amber">
                {packs.length} GAMES
              </span>
            </div>
          </div>

          {/* Primary tabs */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setActiveType("featured")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full font-display text-xs tracking-wide transition-all flex-1 justify-center"
              style={{
                background: activeType === "featured" ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${activeType === "featured" ? "rgba(34,211,238,0.5)" : "rgba(255,255,255,0.08)"}`,
                color: activeType === "featured" ? "#22d3ee" : "#8888aa",
                boxShadow: activeType === "featured" ? "0 0 16px rgba(34,211,238,0.12)" : "none",
              }}
            >
              ⭐ FEATURED
              <span
                className="px-1.5 py-0.5 rounded-full text-xs"
                style={{
                  background: activeType === "featured" ? "rgba(34,211,238,0.25)" : "rgba(255,255,255,0.06)",
                  color: activeType === "featured" ? "#22d3ee" : "#666688",
                }}
              >
                {featuredCount}
              </span>
            </button>
            <button
              onClick={() => setActiveType("club")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full font-display text-xs tracking-wide transition-all flex-1 justify-center"
              style={{
                background: activeType === "club" ? "rgba(255,184,0,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${activeType === "club" ? "rgba(255,184,0,0.5)" : "rgba(255,255,255,0.08)"}`,
                color: activeType === "club" ? "#ffb800" : "#8888aa",
                boxShadow: activeType === "club" ? "0 0 16px rgba(255,184,0,0.12)" : "none",
              }}
            >
              ⚽ CLUB
              <span
                className="px-1.5 py-0.5 rounded-full text-xs"
                style={{
                  background: activeType === "club" ? "rgba(255,184,0,0.25)" : "rgba(255,255,255,0.06)",
                  color: activeType === "club" ? "#ffb800" : "#666688",
                }}
              >
                {clubCount}
              </span>
            </button>
            <button
              onClick={() => setActiveType("records")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full font-display text-xs tracking-wide transition-all flex-1 justify-center"
              style={{
                background: activeType === "records" ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${activeType === "records" ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.08)"}`,
                color: activeType === "records" ? "#a78bfa" : "#8888aa",
                boxShadow: activeType === "records" ? "0 0 16px rgba(167,139,250,0.12)" : "none",
              }}
            >
              🏆 RECORDS
              <span
                className="px-1.5 py-0.5 rounded-full text-xs"
                style={{
                  background: activeType === "records" ? "rgba(167,139,250,0.25)" : "rgba(255,255,255,0.06)",
                  color: activeType === "records" ? "#a78bfa" : "#666688",
                }}
              >
                {recordsCount}
              </span>
            </button>
          </div>

          {/* League sub-filter — only for Club Games */}
          {activeType === "club" && (
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full font-body text-xs font-semibold text-green"
                style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.3)" }}
              >
                <span className="bg-green" style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", boxShadow: "0 0 6px #00ff87" }} />
                Premier League
              </div>
            </div>
          )}
          {/* Featured banner */}
          {activeType === "featured" && (
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full font-body text-xs font-semibold"
                style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee" }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22d3ee", display: "inline-block", boxShadow: "0 0 6px #22d3ee" }} />
                New this week
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Build a Quiz banner */}
      <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
        <button
          onClick={() => router.push("/quiz/create")}
          className="w-full rounded-2xl overflow-hidden transition-all duration-150 active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, rgba(0,255,135,0.12) 0%, rgba(0,200,100,0.06) 100%)",
            border: "1px solid rgba(0,255,135,0.3)",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 0 24px rgba(0,255,135,0.06)",
          }}
        >
          <div style={{ textAlign: "left" }}>
            <p className="font-display text-sm tracking-wide text-green">
              ✨ BUILD YOUR OWN QUIZ
            </p>
            <p className="font-body text-xs mt-0.5 text-text-muted">
              Pick a team or topic · choose your era · challenge a friend
            </p>
          </div>
          <span className="font-display text-lg text-green">→</span>
        </button>
      </div>

      {/* Cards grid */}
      <div className="max-w-lg mx-auto px-4 pt-2">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-3xl bg-surface"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                  height: 200,
                  opacity: 0.3,
                }}
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-4">🏟️</p>
            <p className="font-body text-sm text-text-muted">No games here yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((pack) =>
              pack.parameter === "2025/26 End of Season" ? (
                <EndOfSeasonCard key={pack.id} pack={pack} />
              ) : pack.type === "club" ? (
                <ClubCard key={pack.id} pack={pack} />
              ) : (
                <RecordsCard key={pack.id} pack={pack} />
              )
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
