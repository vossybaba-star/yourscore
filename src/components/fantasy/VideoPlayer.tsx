"use client";
/**
 * Native video playback for Social posts (5 Aug) — Supabase storage direct, no
 * transcoding, no HLS. `InlineVideoPlayer` is THE one reusable player: the feed,
 * post detail, and (indirectly, via its own poster-only render) quote embeds all
 * go through it or its poster.
 *
 * Accepted risk (founder-locked): an HEVC-only .mov may not decode on Chrome/
 * Android. There is no server-side check for this — the player must show an
 * honest "Video unavailable." over the poster on a playback error, never a
 * black box and never a broken control bar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LINE, PANEL, PANEL_2 } from "@/components/fantasy/shared";
import {
  trackVideoImpression, trackVideoPlay, trackVideoSoundOn, trackVideoQuartile,
  trackVideoFullscreenOpened, trackVideoError,
} from "@/lib/analytics/trackSocial";

export interface PostVideo {
  url: string;
  posterUrl: string | null;
  width: number;
  height: number;
  durationMs: number;
}

const MAX_INLINE_HEIGHT = 520;

// ── One active player at a time ──────────────────────────────────────────
// A feed can render many InlineVideoPlayers; only one should ever be making
// noise/motion. When a player starts, it pauses whichever one was previously
// playing. Module-level rather than context, since these players can live in
// completely separate render trees (feed card vs. its own detail page).
let activePlayerEl: HTMLVideoElement | null = null;
function claimActivePlayer(el: HTMLVideoElement): void {
  if (activePlayerEl && activePlayerEl !== el) activePlayerEl.pause();
  activePlayerEl = el;
}
function releaseActivePlayer(el: HTMLVideoElement): void {
  if (activePlayerEl === el) activePlayerEl = null;
}

// ── Session sound memory ─────────────────────────────────────────────────
// Once the viewer deliberately unmutes ONE video, the next video they
// actively watch (auto-played into view, or tapped) starts unmuted too — a
// mute anywhere flips it back off. Module-level, so it survives across
// separate player mounts within the same page session (not persisted).
let soundOnForSession = false;
function setSessionSound(on: boolean): void {
  soundOnForSession = on;
  if (on) trackVideoSoundOn();
}

function prefersNoAutoplay(): boolean {
  if (typeof window === "undefined") return false;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // navigator.connection is Chrome/Android-only and untyped in lib.dom.
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return reducedMotion || !!conn?.saveData;
}

function fmtCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

// ── Bare SVG glyphs (X-grade stroke icons, no emoji) ─────────────────────
function PlayGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function MuteGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4z" /><path d="M16 9l6 6M22 9l-6 6" />
    </svg>
  );
}
function UnmuteGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
    </svg>
  );
}
function FullscreenGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 1-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    </svg>
  );
}
function CloseGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}
function ErrorGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

/** A poster-only, non-interactive preview — what a quote/repost's compact
 *  embed shows for a video (poster + play glyph, tap goes to the post's
 *  detail page rather than inline-playing). Not exported as a "player"
 *  because it plays nothing; it's just the honest static preview. */
export function VideoPosterPreview({ video, height = 120 }: { video: PostVideo; height?: number }) {
  return (
    <div style={{ position: "relative", width: "100%", height, borderRadius: 8, overflow: "hidden", background: PANEL, marginTop: 6 }}>
      {video.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.posterUrl} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: video.posterUrl ? "rgba(0,0,0,0.25)" : PANEL_2,
      }}>
        <span style={{ width: 34, height: 34, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PlayGlyph size={16} />
        </span>
      </div>
    </div>
  );
}

/** THE reusable inline video player — poster-first, hysteresis autoplay,
 *  single-active-player, session sound memory, reduced-motion/data-saver
 *  respected, an honest error state instead of a black box. */
export function InlineVideoPlayer({ video, context }: {
  video: PostVideo;
  /** Optional identity for the surface this is mounted in — not required by
   *  any current behaviour, just future-proofing for per-post analytics. */
  context?: { postId?: string };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [errored, setErrored] = useState(false);
  const [tapToPlayOnly] = useState(() => prefersNoAutoplay());
  const [everStarted, setEverStarted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [fsOpen, setFsOpen] = useState(false);

  const impressionFired = useRef(false);
  const quartilesFired = useRef({ q25: false, q50: false, q75: false, completed: false });

  useEffect(() => { if (soundOnForSession) setMuted(false); }, []);

  const attemptPlay = useCallback((auto: boolean) => {
    const el = videoRef.current;
    if (!el || errored) return;
    claimActivePlayer(el);
    el.play().then(() => {
      setPlaying(true);
      setEverStarted(true);
      trackVideoPlay(auto ? "auto" : "tap");
    }).catch(() => { /* autoplay blocked or user gesture required — stays paused */ });
  }, [errored]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  // Visibility-driven autoplay with hysteresis: play at >=60% visible, pause
  // below 40%, nothing in between (no flicker at the boundary).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (!impressionFired.current && entry.intersectionRatio > 0) {
        impressionFired.current = true;
        trackVideoImpression();
      }
      if (tapToPlayOnly) return; // reduced-motion / saveData: tap only, ever
      if (entry.intersectionRatio >= 0.6) attemptPlay(true);
      else if (entry.intersectionRatio < 0.4) pause();
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapToPlayOnly, errored]);

  // Backgrounding the tab pauses playback.
  useEffect(() => {
    const onVis = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pause]);

  useEffect(() => {
    const el = videoRef.current;
    return () => { if (el) releaseActivePlayer(el); };
  }, []);

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !el.duration) return;
    setCurrentTime(el.currentTime);
    const frac = el.currentTime / el.duration;
    const q = quartilesFired.current;
    if (frac >= 0.25 && !q.q25) { q.q25 = true; trackVideoQuartile("q25"); }
    if (frac >= 0.5 && !q.q50) { q.q50 = true; trackVideoQuartile("q50"); }
    if (frac >= 0.75 && !q.q75) { q.q75 = true; trackVideoQuartile("q75"); }
  };
  const onEnded = () => {
    if (!quartilesFired.current.completed) { quartilesFired.current.completed = true; trackVideoQuartile("completed"); }
    setPlaying(false);
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMuted((m) => { const next = !m; setSessionSound(!next); return next; });
  };

  const tapToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (errored) return;
    if (playing) pause(); else attemptPlay(false);
  };

  const openFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    trackVideoFullscreenOpened();
    videoRef.current?.pause();
    setFsOpen(true);
  };
  const closeFullscreen = (handoffTime: number) => {
    setFsOpen(false);
    setCurrentTime(handoffTime);
    const el = videoRef.current;
    if (el) {
      el.currentTime = handoffTime;
      if (playing) el.play().catch(() => {});
    }
  };

  const durationMs = video.durationMs || 0;
  const remainingMs = Math.max(0, durationMs - currentTime * 1000);
  const showBigPlay = !playing && !errored;

  return (
    <div ref={containerRef} data-post-id={context?.postId} onClick={(e) => e.stopPropagation()} style={{
      position: "relative", marginTop: 10, width: "100%",
      maxHeight: MAX_INLINE_HEIGHT, aspectRatio: `${video.width || 16} / ${video.height || 9}`,
      borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: PANEL,
    }}>
      {video.posterUrl && (!everStarted || errored) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.posterUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      {!errored && (
        <video
          ref={videoRef}
          src={video.url}
          poster={video.posterUrl ?? undefined}
          muted={muted}
          playsInline
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onPause={() => setPlaying(false)}
          onError={() => { setErrored(true); setPlaying(false); trackVideoError(); }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
        />
      )}

      {errored ? (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 8, background: "rgba(0,0,0,0.55)", color: "#c7d0cb",
        }}>
          <ErrorGlyph />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Video unavailable.</span>
        </div>
      ) : (
        <button onClick={tapToggle} aria-label={playing ? "Pause video" : "Play video"} style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, margin: 0,
          background: "none", border: "none", cursor: "pointer",
        }}>
          {showBigPlay && (
            <span style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              width: 52, height: 52, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <PlayGlyph size={24} />
            </span>
          )}
        </button>
      )}

      {!errored && (
        <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}>
          <div style={{ flex: 1, height: 3, borderRadius: 999, background: "rgba(255,255,255,0.28)", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "rgba(255,255,255,0.9)", width: durationMs ? `${Math.min(100, (currentTime * 1000 / durationMs) * 100)}%` : "0%" }} />
          </div>
          {durationMs > 0 && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
              {fmtCountdown(remainingMs)}
            </span>
          )}
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} style={{
            pointerEvents: "auto", width: 26, height: 26, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
            border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            {muted ? <MuteGlyph /> : <UnmuteGlyph />}
          </button>
          <button onClick={openFullscreen} aria-label="Open fullscreen" style={{
            pointerEvents: "auto", width: 26, height: 26, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
            border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <FullscreenGlyph />
          </button>
        </div>
      )}

      {fsOpen && (
        <FullscreenVideoPlayer video={video} startTime={currentTime} muted={muted}
          onMutedChange={(m) => { setMuted(m); setSessionSound(!m); }} onClose={closeFullscreen} />
      )}
    </div>
  );
}

/** Portal fullscreen overlay — same z-band as the composer's Sheet (z-60),
 *  native-feeling custom controls, scrub bar, swipe-down or Escape to
 *  dismiss. Opens at the inline player's currentTime; hands the position
 *  back on close so the inline player picks up where fullscreen left off. */
function FullscreenVideoPlayer({ video, startTime, muted, onMutedChange, onClose }: {
  video: PostVideo; startTime: number; muted: boolean;
  onMutedChange: (m: boolean) => void;
  onClose: (handoffTime: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(startTime);
  const [duration, setDuration] = useState((video.durationMs || 0) / 1000);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = startTime;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [startTime]);

  const closeNow = useCallback(() => {
    onClose(videoRef.current?.currentTime ?? currentTime);
  }, [onClose, currentTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeNow(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [closeNow]);

  // Backgrounding the tab pauses fullscreen playback too.
  useEffect(() => {
    const onVis = () => { if (document.hidden) { videoRef.current?.pause(); setPlaying(false); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); } else { el.play().catch(() => {}); setPlaying(true); }
  };
  const toggleMute = () => onMutedChange(!muted);
  const onTimeUpdate = () => { const el = videoRef.current; if (el) setCurrentTime(el.currentTime); };
  const onLoadedMeta = () => { const el = videoRef.current; if (el && el.duration) setDuration(el.duration); };
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) closeNow(); // swipe-down dismiss
  };

  const overlay = (
    <div
      role="dialog" aria-modal="true" aria-label="Video"
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "#000",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <style>{`
        .ys-video-scrub { -webkit-appearance: none; appearance: none; width: 100%; height: 3px; border-radius: 999px; background: rgba(255,255,255,0.28); outline: none; }
        .ys-video-scrub::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 999px; background: #fff; cursor: pointer; }
        .ys-video-scrub::-moz-range-thumb { width: 13px; height: 13px; border-radius: 999px; background: #fff; border: none; cursor: pointer; }
      `}</style>
      <video
        ref={videoRef}
        src={video.url}
        muted={muted}
        playsInline
        onClick={togglePlay}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMeta}
        onEnded={() => setPlaying(false)}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />

      <button onClick={closeNow} aria-label="Close video" style={{
        position: "absolute", top: "calc(14px + env(safe-area-inset-top))", right: 14,
        width: 40, height: 40, borderRadius: 999, background: "rgba(0,0,0,0.5)", color: "#fff",
        border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      }}><CloseGlyph /></button>

      <div style={{
        position: "absolute", left: 0, right: 0, bottom: "calc(18px + env(safe-area-inset-bottom))",
        padding: "0 16px", display: "flex", flexDirection: "column", gap: 10,
      }}>
        <input className="ys-video-scrub" type="range" min={0} max={Math.max(duration, 0.1)} step={0.1}
          value={Math.min(currentTime, duration)} onChange={seek} aria-label="Seek" />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} style={{
            width: 44, height: 44, borderRadius: 999, background: "rgba(255,255,255,0.14)", color: "#fff",
            border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>{playing ? <PauseGlyph /> : <PlayGlyph />}</button>
          <span style={{ fontSize: 12.5, color: "#c7d0cb", fontVariantNumeric: "tabular-nums" }}>
            {fmtCountdown(currentTime * 1000)} / {fmtCountdown(duration * 1000)}
          </span>
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} style={{
            width: 44, height: 44, borderRadius: 999, background: "rgba(255,255,255,0.14)", color: "#fff",
            border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>{muted ? <MuteGlyph size={18} /> : <UnmuteGlyph size={18} />}</button>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(overlay, document.body) : null;
}
