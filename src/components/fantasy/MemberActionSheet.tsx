"use client";
/**
 * The one member action sheet, shared by every surface that shows another
 * manager: the league table, league chat, the members list, and the league
 * hub (Phase 1B). Tapping a member anywhere opens THIS, not a bespoke menu
 * per surface.
 *
 * Primary row (Profile / Squad / Mention / Compare) is bare-SVG icon chips —
 * never emoji, matching the house style (shared.tsx). A secondary list of
 * plain rows carries Follow/Mute/Block/Report, reusing the exact endpoints
 * FeedStream's CardMenu and LeagueChatView's Reactions row already use, so
 * blocking/muting/reporting someone behaves identically everywhere it's
 * offered.
 *
 * "Remove from league" is deliberately absent: there is no remove/kick
 * endpoint under /api/fantasy/leagues/[code]/* yet, and a button with nowhere
 * to send its tap is worse than no button (acceptance criterion: no dead
 * buttons). `isLeagueOwner` is kept on the prop surface for when that API
 * lands, but nothing reads it today.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { INK, LINE, MUTED, PANEL, PANEL_2, Sheet, TEAL } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { FollowButton } from "@/components/social/FollowButton";
import { ReportSheet } from "@/components/social/ReportSheet";
import { CompareSquadsSheet } from "@/components/fantasy/CompareSquadsSheet";
import { trackBlockUser, trackMuteUser, trackMemberActionSelected, trackMemberSheetOpened } from "@/lib/analytics/trackSocial";

export interface MemberActionMember {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** League standing, when the caller already has it loaded (table/hub rows,
   *  the members list) — shown in the header, never fetched by this sheet. */
  rank?: number;
  points?: number;
}

interface RunView {
  gw: number; name: string; correct: number; total: number;
  questions: { prompt: string; picked: string | null; answer: string; right: boolean }[];
}

export const nameOfMember = (m: { username: string | null; displayName: string | null }) =>
  m.displayName ?? (m.username ? `@${m.username}` : "Player");

// ── bare-SVG icons (house rule: never emoji) ─────────────────────────────
function IconWrap({ children }: { children: React.ReactNode }) {
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const ProfileIcon = () => <IconWrap><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" /></IconWrap>;
const SquadIcon = () => <IconWrap><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></IconWrap>;
const MentionIcon = () => <IconWrap><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.2" /><path d="M15.2 12v1.6a2.4 2.4 0 004.8 0V12a8 8 0 10-3.4 6.5" /></IconWrap>;
const CompareIcon = () => <IconWrap><path d="M8 4v16M16 4v16" /><path d="M4 9h4M4 15h4M16 9h4M16 15h4" /></IconWrap>;
const MuteIcon = () => <IconWrap><path d="M9 9v3a3 3 0 005.7 1.3M12 5a3 3 0 013 3v1" /><path d="M19 11a7 7 0 01-1 3.6M5 11a7 7 0 007 7" /><path d="M3 3l18 18" /></IconWrap>;
const BlockIcon = () => <IconWrap><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></IconWrap>;
const ReportIcon = () => <IconWrap><path d="M5 4v16" /><path d="M5 4h11l-2.5 3.5L16 11H5" /></IconWrap>;

function ActionChip({ icon, label, href, onClick, onNavigate }: {
  icon: React.ReactNode; label: string; href?: string; onClick?: () => void; onNavigate?: () => void;
}) {
  const style: React.CSSProperties = {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5,
    flex: 1, minHeight: 60, minWidth: 60, borderRadius: 14, cursor: "pointer",
    background: PANEL_2, border: `1px solid ${LINE}`, color: TEAL, textDecoration: "none",
  };
  const inner = (
    <>
      {icon}
      <span className="font-body" style={{ fontSize: 10.5, fontWeight: 600, color: INK }}>{label}</span>
    </>
  );
  if (href) return <Link href={href} aria-label={label} onClick={onNavigate} style={style}>{inner}</Link>;
  return <button aria-label={label} onClick={onClick} style={style}>{inner}</button>;
}

function SecondaryRow({ icon, label, onClick, accent = INK }: {
  icon: React.ReactNode; label: string; onClick: () => void; accent?: string;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
      minHeight: 44, background: "none", border: "none", borderTop: `1px solid ${LINE}`, padding: "11px 2px",
      fontSize: 13.5, fontWeight: 600, color: accent,
    }}>
      <span aria-hidden style={{ width: 19, height: 19, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
      {label}
    </button>
  );
}

export function MemberActionSheet({
  member, context, leagueCode, viewerId, onClose, onMention,
}: {
  member: MemberActionMember;
  context: "league" | "chat" | "feed";
  leagueCode?: string;
  /** Kept on the prop surface for when a remove/kick API exists — nothing
   *  reads it today (see the file doc comment: no dead "Remove from league"
   *  button without a real endpoint to call). */
  isLeagueOwner?: boolean;
  viewerId: string | null;
  onClose: () => void;
  /** Chat only — the composer inserts "@username " and focuses itself. */
  onMention?: (username: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isSelf = !!viewerId && viewerId === member.userId;
  const displayName = nameOfMember(member);

  const [mentionChoice, setMentionChoice] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  // The stats section: the member's completed quiz round for THIS gameweek,
  // relocated unchanged from LeagueTableView's peek() (same fetch, same 401/
  // not-available handling) — the founder's call was to move it inside this
  // sheet rather than a standalone overlay.
  const [run, setRun] = useState<RunView | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);

  useEffect(() => { trackMemberSheetOpened(context); }, [context]);

  useEffect(() => {
    if (context !== "league" || !leagueCode || !viewerId) return;
    let live = true;
    setRunLoading(true); setRun(null); setRunNote(null);
    fetch(`/api/fantasy/leagues/${leagueCode}/run?user=${member.userId}`)
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) {
          if (res.status === 401) router.push(`/auth/sign-in?next=${encodeURIComponent(pathname ?? "/")}`);
          else setRunNote(j.error ?? "Not available yet.");
          return;
        }
        setRun(j as RunView);
      })
      .catch((e) => { if (live) setRunNote((e as Error).message); })
      .finally(() => { if (live) setRunLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, leagueCode, member.userId, viewerId]);

  const signIn = () => router.push(`/auth/sign-in?next=${encodeURIComponent(pathname ?? "/")}`);

  const handleMention = () => {
    if (!viewerId) { signIn(); return; }
    trackMemberActionSelected("mention");
    if (context === "chat") {
      onMention?.(member.username ?? "");
      onClose();
      return;
    }
    setMentionChoice(true);
  };
  const mentionInChat = () => {
    if (!leagueCode || !member.username) return;
    router.push(`/fantasy/leagues/${leagueCode}?t=chat&mention=${encodeURIComponent(member.username)}`);
    onClose();
  };
  const mentionInPost = () => {
    if (!member.username) return;
    router.push(`/fantasy/social?compose=${encodeURIComponent(`@${member.username} `)}`);
    onClose();
  };

  const handleCompare = () => {
    if (!viewerId) { signIn(); return; }
    trackMemberActionSelected("compare");
    setCompareOpen(true);
  };

  const [safetyBusy, setSafetyBusy] = useState(false);
  const blockMember = () => {
    if (safetyBusy) return;
    if (!window.confirm(`Block ${displayName}? You won't see each other's posts, and you'll stop following each other.`)) return;
    setSafetyBusy(true);
    trackMemberActionSelected("block");
    fetch("/api/social/block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.userId }) })
      .then((res) => { if (res.ok) trackBlockUser(); })
      .finally(() => { setSafetyBusy(false); onClose(); });
  };
  const muteMember = () => {
    if (safetyBusy) return;
    if (!window.confirm(`Mute ${displayName}? Their posts won't show for you.`)) return;
    setSafetyBusy(true);
    trackMemberActionSelected("mute");
    fetch("/api/social/mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.userId }) })
      .then((res) => { if (res.ok) trackMuteUser(); })
      .finally(() => { setSafetyBusy(false); onClose(); });
  };

  // Compare only makes sense against someone else's squad, in a league.
  const showCompare = context === "league" && !!leagueCode && !isSelf;
  // Mention needs a real @handle — every destination (composer insert, the
  // chat/post routes) writes "@username", so without one this would be a tap
  // that does nothing (no dead buttons).
  const showMention = !isSelf && !!member.username;
  const showSecondary = !isSelf && !!viewerId;

  return (
    <Sheet onClose={onClose} labelledBy="member-sheet-title">
      {mentionChoice ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <button onClick={() => setMentionChoice(false)} aria-label="Back" style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 999,
              background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer", flexShrink: 0,
            }}>←</button>
            <span id="member-sheet-title" className="font-display" style={{ fontSize: 16, color: INK }}>
              Mention {displayName}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {leagueCode && (
              <button onClick={mentionInChat} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
                minHeight: 48, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px",
                fontSize: 13.5, fontWeight: 600, color: INK,
              }}>Mention in league chat</button>
            )}
            <button onClick={mentionInPost} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
              minHeight: 48, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px",
              fontSize: 13.5, fontWeight: 600, color: INK,
            }}>Mention in a post</button>
          </div>
        </>
      ) : (
        <>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <PlayerAvatar seed={member.userId} name={displayName} avatarUrl={member.avatarUrl} size={52} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div id="member-sheet-title" className="font-display" style={{ fontSize: 18, lineHeight: 1.1, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}{isSelf ? <span style={{ color: TEAL, fontWeight: 700 }}> · you</span> : ""}
              </div>
              {member.username && (
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>@{member.username}</div>
              )}
              {(member.rank !== undefined || member.points !== undefined) && (
                <div style={{ fontSize: 12.5, color: TEAL, fontWeight: 700, marginTop: 4 }}>
                  {member.rank !== undefined ? `#${member.rank}` : ""}
                  {member.rank !== undefined && member.points !== undefined ? " · " : ""}
                  {member.points !== undefined ? `${member.points} pts` : ""}
                </div>
              )}
            </div>
          </div>

          {/* Primary row — Profile / Squad always; Mention / Compare when they apply. */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <ActionChip icon={<ProfileIcon />} label="Profile" href={`/profile/${member.userId}`} onNavigate={onClose} />
            <ActionChip icon={<SquadIcon />} label="Squad" href={`/profile/${member.userId}#fantasy-xi`} onNavigate={onClose} />
            {showMention && <ActionChip icon={<MentionIcon />} label="Mention" onClick={handleMention} />}
            {showCompare && <ActionChip icon={<CompareIcon />} label="Compare" onClick={handleCompare} />}
          </div>

          {/* Stats — this gameweek's quiz round, member-in-a-shared-league only. */}
          {context === "league" && leagueCode && viewerId && (
            <div style={{ marginBottom: showSecondary ? 4 : 0 }}>
              <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>THIS GAMEWEEK</div>
              {runLoading && <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>Loading…</p>}
              {!runLoading && runNote && <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{runNote}</p>}
              {!runLoading && run && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>
                    {run.name} got {run.correct}/{run.total} in Gameweek {run.gw}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                    {run.questions.map((q, i) => (
                      <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 11px" }}>
                        <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "pre-line", lineHeight: 1.4 }}>{q.prompt}</div>
                        <div style={{ fontSize: 13, marginTop: 5, fontWeight: 600, color: q.right ? "#7BC98B" : "#E08A6B" }}>
                          {q.right ? "✓" : "✗"} {q.picked ?? "ran out of time"}
                          {!q.right && <span style={{ color: MUTED, fontWeight: 400 }}> · it was {q.answer}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Secondary — plain rows, never shown for a self-view or a guest. */}
          {showSecondary && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 2px", borderTop: `1px solid ${LINE}` }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>Follow</span>
                <FollowButton userId={member.userId} size="sm" />
              </div>
              <SecondaryRow icon={<MuteIcon />} label="Mute" onClick={muteMember} />
              <SecondaryRow icon={<BlockIcon />} label="Block" onClick={blockMember} accent="#E08A6B" />
              <SecondaryRow icon={<ReportIcon />} label="Report" onClick={() => { trackMemberActionSelected("report"); setReportOpen(true); }} accent="#E08A6B" />
            </div>
          )}
        </>
      )}

      {reportOpen && <ReportSheet subjectType="profile" subjectId={member.userId} onClose={() => setReportOpen(false)} />}
      {compareOpen && viewerId && leagueCode && (
        <CompareSquadsSheet
          leagueCode={leagueCode}
          viewerId={viewerId}
          target={{ userId: member.userId, name: displayName, avatarUrl: member.avatarUrl, username: member.username }}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </Sheet>
  );
}
