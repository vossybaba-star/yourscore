"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect } from "react";

function QuizReadyContent() {
  const params = useSearchParams();
  const router = useRouter();
  const packId = params.get("packId") ?? "";
  const slug = params.get("slug") ?? "";

  // Landed here without a pack (stale link, refresh after navigation) — bounce
  // back to the builder. Run as an effect, not during render, so we don't fire a
  // navigation as a render side-effect.
  useEffect(() => {
    if (!packId) router.replace("/quiz/create");
  }, [packId, router]);

  if (!packId) return null;

  return (
    <div className="bg-bg min-h-screen flex flex-col items-center justify-center px-5">
      <style>{`
        @keyframes popIn {
          0% { opacity: 0; transform: scale(0.85) translateY(20px); }
          70% { transform: scale(1.04) translateY(-2px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .pop-in { animation: popIn 0.5s cubic-bezier(.34,1.56,.64,1) both; }
        .slide-1 { animation: slideUp 0.4s ease-out 0.3s both; }
        .slide-2 { animation: slideUp 0.4s ease-out 0.42s both; }
        .slide-3 { animation: slideUp 0.4s ease-out 0.54s both; }
      `}</style>

      <div style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>

        {/* Trophy */}
        <div className="pop-in" style={{ marginBottom: 24 }}>
          <div style={{
            width: 80, height: 80, borderRadius: 24, margin: "0 auto",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, rgba(174,234,0,0.2), rgba(174,234,0,0.08))",
            border: "1.5px solid rgba(174,234,0,0.4)",
            boxShadow: "0 0 40px rgba(174,234,0,0.2)",
            fontSize: 38,
          }}>
            ⚡
          </div>
        </div>

        <h1 className="slide-1" style={{
          fontFamily: "var(--font-display, sans-serif)", fontSize: 28,
          fontWeight: 700, color: "#ffffff", margin: "0 0 8px",
          letterSpacing: "-0.02em",
        }}>
          Quiz Ready
        </h1>
        <p className="slide-2" style={{
          fontFamily: "var(--font-body, sans-serif)", fontSize: 14,
          color: "#8a948f", marginBottom: 32,
        }}>
          What do you want to do with it?
        </p>

        <div className="slide-2" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Play Solo */}
          <Link
            href={`/challenges/${slug}?pid=${packId}`}
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "16px 18px", borderRadius: 16, textDecoration: "none",
              background: "linear-gradient(135deg, rgba(174,234,0,0.14), rgba(174,234,0,0.06))",
              border: "1px solid rgba(174,234,0,0.35)",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(174,234,0,0.15)", fontSize: 20,
            }}>🎯</div>
            <div style={{ textAlign: "left" }}>
              <p style={{ fontFamily: "var(--font-display, sans-serif)", fontSize: 15, fontWeight: 700, color: "#aeea00", margin: 0 }}>
                Play Solo
              </p>
              <p style={{ fontFamily: "var(--font-body, sans-serif)", fontSize: 12, color: "#6eeab0", margin: "2px 0 0" }}>
                Play it now on your own
              </p>
            </div>
            <svg style={{ marginLeft: "auto", flexShrink: 0 }} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5 3l6 5-6 5" stroke="#aeea00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>

          {/* Use in Lobby */}
          <Link
            href={`/play/new?packId=${packId}`}
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "16px 18px", borderRadius: 16, textDecoration: "none",
              background: "linear-gradient(135deg, rgba(174,234,0,0.14), rgba(174,234,0,0.06))",
              border: "1px solid rgba(174,234,0,0.35)",
              transition: "all 0.15s ease",
            }}
          >
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(174,234,0,0.15)", fontSize: 20,
            }}>👥</div>
            <div style={{ textAlign: "left" }}>
              <p style={{ fontFamily: "var(--font-display, sans-serif)", fontSize: 15, fontWeight: 700, color: "#aeea00", margin: 0 }}>
                Open a Lobby
              </p>
              <p style={{ fontFamily: "var(--font-body, sans-serif)", fontSize: 12, color: "#9aa39d", margin: "2px 0 0" }}>
                Play with your friends
              </p>
            </div>
            <svg style={{ marginLeft: "auto", flexShrink: 0 }} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5 3l6 5-6 5" stroke="#aeea00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>

          {/* Back */}
          <Link
            href="/quiz/create"
            className="slide-3"
            style={{
              display: "block", padding: "12px", borderRadius: 14,
              fontFamily: "var(--font-body, sans-serif)", fontSize: 13, fontWeight: 600,
              color: "#586058", textAlign: "center", textDecoration: "none",
              marginTop: 4,
            }}
          >
            ← Build another
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function QuizReadyPage() {
  return (
    <Suspense>
      <QuizReadyContent />
    </Suspense>
  );
}
