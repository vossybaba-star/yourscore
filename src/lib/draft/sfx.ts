"use client";

/**
 * 38-0 game-feel: tiny synthesized sound effects + haptics for the shootout.
 *
 * Everything is generated with WebAudio oscillators and filtered noise — no audio
 * assets, no licensing, ~zero bundle weight. Sound is MUTED BY DEFAULT and gated
 * behind a persisted toggle; haptics are always-on but subtle (no-ops where
 * unsupported). The AudioContext is created lazily on a user gesture (every
 * shootout interaction is a tap, so autoplay policies are satisfied).
 */

const KEY = "draftxi:sfx"; // "1" = sound on

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let soundOn = false;

export function sfxEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setSfxEnabled(on: boolean): void {
  soundOn = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ }
  if (on) ensureCtx(); // user gesture — safe to (re)start the context now
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    // 1s of white noise, reused by every noise-based effect.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function ready(): AudioContext | null {
  if (!soundOn) soundOn = sfxEnabled();
  if (!soundOn) return null;
  return ensureCtx();
}

/** Filtered noise burst: crowd roars, thuds, swooshes. */
function noise(opts: { t?: number; dur: number; from: number; to: number; freq: number; q?: number; type?: BiquadFilterType; peak?: number; attack?: number }): void {
  const c = ready();
  if (!c || !noiseBuf) return;
  const t = c.currentTime + (opts.t ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = opts.type ?? "bandpass";
  filter.frequency.setValueAtTime(opts.from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t + opts.dur);
  filter.Q.value = opts.q ?? 0.8;
  filter.frequency.value = opts.freq;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(opts.peak ?? 0.18, t + (opts.attack ?? 0.04));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(t);
  src.stop(t + opts.dur + 0.05);
}

/** Pitched blip: whistles, fanfares, groan sweeps. */
function tone(opts: { t?: number; dur: number; from: number; to?: number; type?: OscillatorType; peak?: number }): void {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + (opts.t ?? 0);
  const osc = c.createOscillator();
  osc.type = opts.type ?? "triangle";
  osc.frequency.setValueAtTime(opts.from, t);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(opts.peak ?? 0.08, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

export const sfx = {
  /** Boot leather: low thump + a short swoosh. */
  kick(): void {
    tone({ dur: 0.12, from: 95, to: 55, type: "sine", peak: 0.22 });
    noise({ dur: 0.18, from: 1800, to: 700, freq: 1200, peak: 0.07, attack: 0.01 });
  },
  /** Net ripple + crowd roar (my goal). */
  goal(): void {
    noise({ dur: 0.16, from: 2600, to: 1200, freq: 1800, peak: 0.1, attack: 0.01 }); // net swish
    noise({ t: 0.08, dur: 1.4, from: 350, to: 900, freq: 600, peak: 0.22, attack: 0.25 }); // roar
    tone({ t: 0.1, dur: 0.3, from: 523, to: 659, peak: 0.05 });
  },
  /** Keeper glove thud + a crowd gasp. */
  save(): void {
    tone({ dur: 0.1, from: 140, to: 70, type: "sine", peak: 0.25 });
    noise({ t: 0.05, dur: 0.7, from: 500, to: 250, freq: 380, peak: 0.12, attack: 0.12 });
  },
  /** Ball gone — descending groan. */
  miss(): void {
    tone({ dur: 0.5, from: 300, to: 150, type: "sawtooth", peak: 0.045 });
    noise({ dur: 0.8, from: 420, to: 200, freq: 320, peak: 0.1, attack: 0.15 });
  },
  /** Referee whistle (shootout start / decisive moment). */
  whistle(): void {
    tone({ dur: 0.22, from: 2350, type: "square", peak: 0.045 });
    tone({ t: 0.06, dur: 0.16, from: 2100, type: "square", peak: 0.035 });
  },
  /** Won the shootout — little rising fanfare over a roar. */
  win(): void {
    noise({ dur: 2.0, from: 400, to: 1000, freq: 700, peak: 0.22, attack: 0.3 });
    [523, 659, 784, 1047].forEach((f, i) => tone({ t: 0.08 + i * 0.12, dur: 0.22, from: f, peak: 0.06 }));
  },
  /** Lost it — low descending pair. */
  loss(): void {
    tone({ dur: 0.5, from: 220, to: 165, type: "triangle", peak: 0.07 });
    tone({ t: 0.25, dur: 0.7, from: 165, to: 110, type: "triangle", peak: 0.07 });
    noise({ dur: 1.2, from: 300, to: 150, freq: 250, peak: 0.08, attack: 0.3 });
  },
};

/** Subtle vibration where supported (Android Chrome etc.); silent no-op elsewhere. */
export function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
