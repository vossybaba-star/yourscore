"use client";

import { useRouter } from "next/navigation";

// The three primary entry actions on the Versus Play tab (mockup: equal-width,
// compact, tap-friendly). FIND routes to instant matchmaking; CHALLENGE and
// JOIN open the existing sheets (wired by the parent).

const TEAL = "#00d8c0";

function RadarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke={TEAL} strokeWidth="1.5" opacity="0.35" />
      <circle cx="10" cy="10" r="4.5" stroke={TEAL} strokeWidth="1.5" opacity="0.6" />
      <circle cx="10" cy="10" r="1.6" fill={TEAL} />
      <path d="M10 10 16 4.5" stroke={TEAL} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M17.5 2.5 9 11M17.5 2.5 12 17.5l-3-6.5-6.5-3L17.5 2.5Z" stroke={TEAL} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4.5" width="16" height="11" rx="2.5" stroke={TEAL} strokeWidth="1.5" />
      <path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Card({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 min-w-0 rounded-2xl p-3 text-left active:scale-[0.97] transition-transform" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.1)" }}>
      {icon}
      <p className="font-display text-[13px] text-white leading-tight mt-2.5" style={{ letterSpacing: "0.02em" }}>{title}</p>
      <p className="font-body text-[10px] text-text-muted leading-snug mt-1">{sub}</p>
    </button>
  );
}

export function VersusActionCards({ onChallenge, onJoinCode }: { onChallenge: () => void; onJoinCode: () => void }) {
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Card icon={<RadarIcon />} title="FIND AN OPPONENT" sub="Get matched instantly" onClick={() => router.push("/versus/find")} />
      <Card icon={<SendIcon />} title="CHALLENGE SOMEONE" sub="Pick a friend or share a link" onClick={onChallenge} />
      <Card icon={<CodeIcon />} title="JOIN WITH CODE" sub="Enter a code to join" onClick={onJoinCode} />
    </div>
  );
}
