"use client";

/**
 * 38-0 penalty shootout — real-time 3D scene (React Three Fiber / three.js).
 *
 * A floodlit night stadium shot from low behind the penalty spot: a 3D goal with
 * a hung net, a striped pitch with cast shadows, a stylised striker (#7, black/lime
 * kit) and keeper (#1, purple), and a ball that flies a real arc while the keeper
 * dives. All geometry + textures are generated at runtime — no image/model assets —
 * so it stays dependency-light beyond three/R3F. The striker & keeper are isolated
 * `<Figure>` components so a rigged GLTF model can drop in later without touching
 * the rest of the scene.
 *
 * Dumb renderer: the controller (PenaltyShootout) owns all game state and hands us
 * `aim` (selected target, for the reticle/addressing) and `play` (a resolved kick
 * to animate); we call `onPlayed()` when the animation completes.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { zoneColumn, zoneRow, type KickOutcome, type PenColumn, type PenZone } from "@/lib/draft/pens";

/**
 * Rigged-model slots. Drop a GLB at these paths and it replaces the procedural
 * figure automatically (auto-fit to height, recoloured to the kit, plays its
 * animation clips). `clips` maps our states → clip names IN the GLB so any
 * Mixamo/Sketchfab export wires up by name.
 *   STRIKER: idle + a kick clip · KEEPER: idle + a dive clip
 * The bundled soldier.glb is a PLACEHOLDER proving the pipeline (idle only); swap
 * in a footballer/keeper export for the real look — see the handoff notes.
 */
// StudioOchi "Low Poly Football Soccer Players" (Fab, purchased) — one GLB with 6
// rigged players in a row sharing one animation. We clone it per slot and isolate a
// single player by its kit material (OchiFigure), so striker + keeper are two real
// kitted players from the same file.
const PLAYERS_URL = "/models/players.glb";
// Fixed roles (no swapping): the TAKER always stands at the spot (lime), the KEEPER
// always in goal (purple). One player mesh drives both — recoloured per role — and a
// "YOU" marker (in PenaltyShootout) shows which one the human controls this turn.
const KIT_MAT = "Athletes_01.001"; // the player mesh we isolate + recolour for both slots
// Model forward axis: the keeper (in goal, facing the shooter) reads correctly at
// y=π; the taker faces the goal at y=0.
const FACE_SHOOTER = Math.PI;
const FACE_GOAL = 0;

// ── Pitch / goal geometry (world units ≈ metres) ───────────────────────────────
const GOAL = { w: 7.32, h: 2.44, z: -9, postR: 0.07 };
const SPOT = new THREE.Vector3(0, 0.12, 2.2);
const COL_X = [-GOAL.w / 2 + 1.35, 0, GOAL.w / 2 - 1.35]; // L / C / R aim columns
const ROW_Y = [0.55, 1.32, 2.05];                          // low / mid / high

const ME = "#b4ff2e";   // lime — you
const OPP = "#a06bff";  // purple — opponent

/** World-space target for a zone (where the ball ends up). */
function zoneTarget(z: PenZone, outcome: KickOutcome): THREE.Vector3 {
  const col = zoneColumn(z);
  const row = zoneRow(z);
  if (outcome === "missed") {
    // wide of the post (corners) or over the bar (center/high)
    const x = col === 1 ? (row === 2 ? 1.6 : -1.6) : col === 0 ? -GOAL.w / 2 - 1.1 : GOAL.w / 2 + 1.1;
    const y = col === 1 ? GOAL.h + 1.2 : ROW_Y[row] + (row === 2 ? 1.4 : 0.2);
    return new THREE.Vector3(x, y, GOAL.z - 0.2);
  }
  return new THREE.Vector3(COL_X[col], ROW_Y[row], GOAL.z + 0.25);
}

// ── Runtime-generated textures ─────────────────────────────────────────────────
function useTextures() {
  return useMemo(() => {
    const mk = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      draw(cv.getContext("2d")!);
      const t = new THREE.CanvasTexture(cv);
      t.anisotropy = 4;
      return t;
    };

    // Grass: mowing stripes + subtle noise.
    const grass = mk(512, 512, (c) => {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = i % 2 ? "#1f7a40" : "#1a6e39";
        c.fillRect(0, (i * 512) / 8, 512, 512 / 8);
      }
      for (let i = 0; i < 9000; i++) {
        c.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
        c.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4);
      }
    });
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(1, 1);

    // Net: fine diamond mesh on transparent.
    const net = mk(256, 256, (c) => {
      c.clearRect(0, 0, 256, 256);
      c.strokeStyle = "rgba(235,240,255,0.5)";
      c.lineWidth = 1;
      const s = 12;
      for (let x = -256; x < 256; x += s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 256, 256); c.stroke(); }
      for (let x = 0; x < 512; x += s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x - 256, 256); c.stroke(); }
    });
    net.wrapS = net.wrapT = THREE.RepeatWrapping;
    net.repeat.set(8, 3);

    // Crowd: dark stand speckled with tiny colored dots (emissive at night).
    const crowd = mk(1024, 256, (c) => {
      c.fillStyle = "#161b2c"; c.fillRect(0, 0, 1024, 256);
      const cols = ["#5b7099", "#6b5a85", "#5a857a", "#8a7560", "#9aa6bf", "#c9d2e6"];
      for (let i = 0; i < 18000; i++) {
        c.fillStyle = cols[(Math.random() * cols.length) | 0];
        c.globalAlpha = 0.55 + Math.random() * 0.45;
        c.fillRect(Math.random() * 1024, Math.random() * 256, 2.6, 2.6);
      }
      c.globalAlpha = 1;
    });
    crowd.wrapS = THREE.RepeatWrapping; crowd.repeat.set(6, 1);

    // Ball: white with dark pentagon-ish patches.
    const ball = mk(256, 256, (c) => {
      c.fillStyle = "#f3f4f8"; c.fillRect(0, 0, 256, 256);
      c.fillStyle = "#1c1c26";
      const patch = (x: number, y: number, r: number) => {
        c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (i) c.lineTo(px, py); else c.moveTo(px, py);
        }
        c.closePath(); c.fill();
      };
      patch(128, 96, 30); patch(54, 150, 22); patch(202, 150, 22); patch(128, 210, 20); patch(20, 60, 16); patch(236, 60, 16);
    });

    return { grass, net, crowd, ball };
  }, []);
}

function kitNumberTexture(n: string, fg: string, bg: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d")!;
  c.fillStyle = bg; c.fillRect(0, 0, 128, 128);
  c.fillStyle = fg; c.font = "bold 88px Arial"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(n, 64, 70);
  return new THREE.CanvasTexture(cv);
}

// ── Stadium + pitch + goal ─────────────────────────────────────────────────────
function Environment({ grass, crowd, net }: { grass: THREE.Texture; crowd: THREE.Texture; net: THREE.Texture }) {
  const post = <meshStandardMaterial color="#f2f4fa" roughness={0.4} metalness={0.1} />;
  const half = GOAL.w / 2;
  return (
    <group>
      {/* pitch */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={grass} roughness={0.95} />
      </mesh>
      {/* painted lines */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, GOAL.z + 0.05]}>
        <planeGeometry args={[40, 0.12]} />
        <meshBasicMaterial color="#eef" transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, SPOT.z]}>
        <circleGeometry args={[0.12, 24]} />
        <meshBasicMaterial color="#eef" transparent opacity={0.6} />
      </mesh>

      {/* stadium bowl: tiered stands wrapping behind the goal */}
      <mesh position={[0, 5.5, GOAL.z - 9]}>
        <cylinderGeometry args={[26, 22, 13, 56, 1, true, Math.PI * 0.62, Math.PI * 1.76]} />
        <meshStandardMaterial map={crowd} side={THREE.BackSide} emissive="#1a1f30" emissiveIntensity={1.1} emissiveMap={crowd} roughness={1} />
      </mesh>
      <mesh position={[0, 12.5, GOAL.z - 11]}>
        <cylinderGeometry args={[30, 26, 8, 56, 1, true, Math.PI * 0.62, Math.PI * 1.76]} />
        <meshStandardMaterial map={crowd} side={THREE.BackSide} emissive="#161a28" emissiveIntensity={0.9} emissiveMap={crowd} roughness={1} />
      </mesh>
      {/* near-side stand rim line + LED hoarding glow behind the goal */}
      <mesh position={[0, 2.0, GOAL.z - 2.0]}>
        <boxGeometry args={[22, 1.0, 0.2]} />
        <meshStandardMaterial color="#06121a" emissive={ME} emissiveIntensity={0.3} />
      </mesh>

      {/* goal frame */}
      <mesh position={[-half, GOAL.h / 2, GOAL.z]} castShadow><cylinderGeometry args={[GOAL.postR, GOAL.postR, GOAL.h, 12]} />{post}</mesh>
      <mesh position={[half, GOAL.h / 2, GOAL.z]} castShadow><cylinderGeometry args={[GOAL.postR, GOAL.postR, GOAL.h, 12]} />{post}</mesh>
      <mesh position={[0, GOAL.h, GOAL.z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[GOAL.postR, GOAL.postR, GOAL.w + GOAL.postR * 2, 12]} />{post}</mesh>
      {/* back + side net */}
      <mesh position={[0, GOAL.h / 2, GOAL.z - 1.5]}>
        <planeGeometry args={[GOAL.w, GOAL.h]} />
        <meshStandardMaterial map={net} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, GOAL.h - 0.2, GOAL.z - 0.75]} rotation={[Math.PI / 2.3, 0, 0]}>
        <planeGeometry args={[GOAL.w, 1.6]} />
        <meshStandardMaterial map={net} transparent opacity={0.42} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * half, GOAL.h / 2, GOAL.z - 0.75]} rotation={[0, s * Math.PI / 2.6, 0]}>
          <planeGeometry args={[1.6, GOAL.h]} />
          <meshStandardMaterial map={net} transparent opacity={0.42} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function Floodlights() {
  return (
    <group>
      <hemisphereLight args={["#cfe0ff", "#0a1a12", 0.55]} />
      <ambientLight intensity={0.18} />
      {[[-9, 12, 5], [9, 12, 5], [-7, 13, GOAL.z - 4], [7, 13, GOAL.z - 4]].map((p, i) => (
        <spotLight
          key={i}
          position={p as [number, number, number]}
          angle={0.7} penumbra={0.6} intensity={i < 2 ? 150 : 110} distance={70} decay={1.3}
          color="#eef3ff" castShadow={i === 0}
          shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004}
          target-position={[0, 0.5, GOAL.z + 1]}
        />
      ))}
      {/* soft fill on the near figures so they read against the dark (white, subtle) */}
      <pointLight position={[0, 3.5, 7]} intensity={7} distance={16} decay={1.8} color="#f2f6ff" />
    </group>
  );
}

// ── Stylised humanoid (GLTF-ready slot) ────────────────────────────────────────
function Figure({ kit, accent, skin, numberTex, dive }: {
  kit: string; accent: string; skin: string; numberTex: THREE.CanvasTexture;
  /** keeper dive driver, 0..1 over the dive; null = striker (no dive). */
  dive?: { col: PenColumn; t: number; high: boolean } | null;
}) {
  const limbMat = <meshStandardMaterial color={kit} roughness={0.6} />;
  return (
    <group>
      {/* torso */}
      <mesh position={[0, 1.02, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.42, 4, 12]} />
        <meshStandardMaterial color={kit} roughness={0.55} />
      </mesh>
      {/* number panel on the back */}
      <mesh position={[0, 1.08, -0.205]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.32, 0.32]} />
        <meshStandardMaterial map={numberTex} transparent />
      </mesh>
      {/* shoulders accent */}
      <mesh position={[0, 1.32, 0]}><capsuleGeometry args={[0.205, 0.12, 3, 10]} /><meshStandardMaterial color={accent} roughness={0.5} /></mesh>
      {/* head */}
      <mesh position={[0, 1.55, 0]} castShadow><sphereGeometry args={[0.16, 16, 16]} /><meshStandardMaterial color={skin} roughness={0.7} /></mesh>
      <mesh position={[0, 1.63, -0.02]}><sphereGeometry args={[0.155, 16, 16, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color="#1c1a22" roughness={0.8} /></mesh>
      {/* arms */}
      {([-1, 1] as const).map((s) => {
        const armDive = dive ? (dive.col === 1 ? 2.7 : s * (dive.col === 0 ? 2.9 : 0.4)) : s * 0.5;
        return (
          <mesh key={s} position={[s * 0.28, 1.12, 0]} rotation={[0, 0, dive ? -s * 0.2 - armDive * 0.18 : s * 0.35]} castShadow>
            <capsuleGeometry args={[0.06, 0.4, 4, 8]} />{limbMat}
          </mesh>
        );
      })}
      {/* legs */}
      {([-1, 1] as const).map((s) => (
        <mesh key={s} position={[s * 0.11, 0.5, 0]} castShadow>
          <capsuleGeometry args={[0.08, 0.5, 4, 8]} />
          <meshStandardMaterial color="#16161e" roughness={0.6} />
        </mesh>
      ))}
      {/* socks accent */}
      {([-1, 1] as const).map((s) => (
        <mesh key={s} position={[s * 0.11, 0.26, 0]}><capsuleGeometry args={[0.082, 0.12, 3, 8]} /><meshStandardMaterial color={accent} /></mesh>
      ))}
    </group>
  );
}

type Play = { shot: PenZone; dive: PenColumn; outcome: KickOutcome; side: "me" | "opp" } | null;

/** A model load/decode failure (draco, texture, bad export) must NEVER kill the
 *  whole canvas — catch it and render the procedural figure instead. */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn("[pens] 3D model failed, using procedural figure:", err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// ── Procedural animation ──────────────────────────────────────────────────────
// The GLB's one baked clip is a useless jog/showcase, so we drive the rig's bones
// directly with poses validated in the sprite spike (three.js bone-local euler,
// matched by base name — bones are suffixed thighR_41 etc). Keyframes are
// interpolated by the play clock, giving real multi-frame motion without the
// asset's missing animation data.
type Pose = Record<string, [number, number, number]>;
type KF = { t: number; p: Pose };

const KICK: KF[] = [
  { t: 0.00, p: { "thighR": [0.55, 0, 0], "shinR": [1.0, 0, 0], "spine.003": [-0.1, 0, 0], "thighL": [-0.1, 0, 0], "upper_armL": [0, 0, 0.3], "upper_armR": [0, 0, -0.2] } },
  { t: 0.16, p: { "thighR": [-1.25, 0, 0], "shinR": [0.4, 0, 0], "spine.003": [0.18, 0, 0], "thighL": [0.18, 0, 0], "upper_armL": [0, 0, 1.0], "upper_armR": [0, 0, -0.6] } },
  { t: 0.30, p: { "thighR": [-1.5, 0, 0], "shinR": [0.12, 0, 0], "spine.003": [0.22, 0, 0], "thighL": [0.1, 0, 0], "upper_armL": [0, 0, 0.9], "upper_armR": [0, 0, -0.5] } },
  { t: 0.62, p: { "spine.003": [0.05, 0, 0] } },
];
const READY: Pose = { "thighL": [0, 0, 0.26], "thighR": [0, 0, -0.26], "upper_armL": [0, 0, 0.55], "upper_armR": [0, 0, -0.55], "forearmL": [0.25, 0, 0], "forearmR": [0.25, 0, 0] };
const REACH: KF[] = [
  { t: 0.00, p: READY },
  { t: 0.30, p: READY },
  { t: 0.70, p: { "upper_armL": [0, 0, 2.5], "upper_armR": [0, 0, -2.5], "forearmL": [0, 0, 0.2], "forearmR": [0, 0, -0.2], "thighL": [0, 0, 0.18], "thighR": [0, 0, -0.18], "shinL": [-0.15, 0, 0], "shinR": [-0.15, 0, 0] } },
];
const CATCH: KF[] = [
  { t: 0.00, p: READY },
  { t: 0.26, p: READY },
  { t: 0.55, p: { "upper_armL": [-1.2, 0, 0.35], "upper_armR": [-1.2, 0, -0.35], "forearmL": [-0.6, 0, 0], "forearmR": [-0.6, 0, 0], "spine.003": [0.12, 0, 0], "thighL": [0, 0, 0.14], "thighR": [0, 0, -0.14], "shinL": [-0.2, 0, 0], "shinR": [-0.2, 0, 0] } },
];

function poseKeys(kfs: KF[]): string[] {
  const s = new Set<string>();
  for (const k of kfs) for (const b of Object.keys(k.p)) s.add(b);
  return Array.from(s);
}
function sampleKF(kfs: KF[], t: number, out: Pose) {
  let a = kfs[0], b = kfs[0];
  for (let i = 0; i < kfs.length; i++) { if (kfs[i].t <= t) { a = kfs[i]; b = kfs[Math.min(i + 1, kfs.length - 1)]; } }
  const span = b.t - a.t;
  const f = span > 0 ? THREE.MathUtils.clamp((t - a.t) / span, 0, 1) : 1;
  for (const key of poseKeys(kfs)) {
    const pa = a.p[key] ?? [0, 0, 0], pb = b.p[key] ?? [0, 0, 0];
    out[key] = [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f, pa[2] + (pb[2] - pa[2]) * f];
  }
}

// Solid single-colour kit (no stripes/number) while keeping a realistic face/skin:
// keep warm pixels (skin + hair), repaint the rest flat to the team colour, and the
// boots' atlas band to dark. (Ported from the sprite spike; runs client-side.)
function recolorKit(src: THREE.MeshStandardMaterial, tintHex: string): THREE.MeshStandardMaterial {
  const mat = src.clone();
  const img = mat.map?.image as (HTMLImageElement | ImageBitmap | undefined);
  if (!img || typeof document === "undefined") return mat;
  const cv = document.createElement("canvas");
  cv.width = (img as HTMLImageElement).width; cv.height = (img as HTMLImageElement).height;
  const ctx = cv.getContext("2d"); if (!ctx) return mat;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height); const px = data.data; const W = cv.width;
  const tc = new THREE.Color(tintHex); const dark = new THREE.Color("#23252e");
  for (let p = 0; p < px.length; p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const warm = r >= g && g >= b && r - b > 12;
    if ((warm && r > 110 && g > 75 && r - b < 130) || (warm && lum < 0.34)) continue; // skin/hair
    const xf = ((p / 4) % W) / W;
    const c = xf >= 0.75 && xf <= 0.875 ? dark : tc; // boot band → dark
    px[p] = c.r * 255; px[p + 1] = c.g * 255; px[p + 2] = c.b * 255;
  }
  ctx.putImageData(data, 0, 0);
  const o = mat.map!; const t = new THREE.CanvasTexture(cv);
  t.flipY = o.flipY; t.colorSpace = o.colorSpace; t.wrapS = o.wrapS; t.wrapT = o.wrapT; t.needsUpdate = true;
  mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
  return mat;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/** Clones the rig, isolates one player, recolours the kit to a flat team colour, and
 *  drives the bones procedurally per role/play (kick for the taker, reach/catch for
 *  the keeper) using the validated poses above. */
function OchiFigure({ keepMaterial, tint, spin = FACE_SHOOTER, role, play, clock }:
  { keepMaterial: string; tint: string; spin?: number; role: "taker" | "keeper"; play: Play; clock: React.MutableRefObject<number> }) {
  const { scene } = useGLTF(PLAYERS_URL);

  const { object, fit, bones, bind } = useMemo(() => {
    const c = skeletonClone(scene) as THREE.Object3D;
    let kept: THREE.Object3D | null = null;
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const name = (m.material as THREE.Material | undefined)?.name ?? "";
        if (name === keepMaterial && !kept) {
          kept = m; m.castShadow = true; m.frustumCulled = false;
          m.material = recolorKit(m.material as THREE.MeshStandardMaterial, tint);
        } else m.visible = false;
      }
    });
    if (!kept) throw new Error(`kit material not found: ${keepMaterial}`);
    const bones = new Map<string, THREE.Bone>();
    const bind = new Map<string, THREE.Quaternion>();
    c.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const base = o.name.replace(/_\d+$/, "");
        bones.set(base, o as THREE.Bone);
        bind.set(base, (o as THREE.Bone).quaternion.clone());
      }
    });
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(kept);
    const size = new THREE.Vector3(); box.getSize(size);
    const ctr = new THREE.Vector3(); box.getCenter(ctr);
    const scale = 1.8 / (size.y || 1);
    return { object: c, fit: { scale, x: -ctr.x * scale, y: -box.min.y * scale, z: -ctr.z * scale }, bones, bind };
  }, [scene, keepMaterial, tint]);

  const pose = useRef<Pose>({});
  useFrame(() => {
    const t = clock.current;
    const p = pose.current;
    for (const k of Object.keys(p)) delete p[k];
    if (role === "taker") {
      if (play) sampleKF(KICK, t, p);
    } else {
      if (play) sampleKF(play.dive === 1 ? CATCH : REACH, t, p);
      else Object.assign(p, READY);
    }
    bones.forEach((b, base) => {
      const e = p[base];
      const bq = bind.get(base)!;
      if (e) { _e.set(e[0], e[1], e[2]); _q.setFromEuler(_e); b.quaternion.copy(bq).multiply(_q); }
      else b.quaternion.copy(bq);
    });
  });

  return (
    <group>
      <group rotation={[0, spin, 0]}>
        <group scale={fit.scale} position={[fit.x, fit.y, fit.z]}>
          <primitive object={object} />
        </group>
      </group>
    </group>
  );
}
useGLTF.preload(PLAYERS_URL);

function Taker({ play, clock }: { play: Play; clock: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  const num = useMemo(() => kitNumberTexture("1", ME, "#0c0c12"), []);
  useFrame(() => {
    if (!ref.current) return;
    const g = ref.current;
    let lean = 0, fwd = 0;
    if (play) { const t = clock.current; if (t < 0.34) { const s = Math.sin((t / 0.34) * Math.PI); fwd = s; lean = s * 0.5; } }
    g.position.set(-0.18 + fwd * 0.3, 0, SPOT.z + 0.95 - fwd * 0.95);
    g.rotation.set(lean * 0.18, FACE_GOAL, 0);
  });
  const fallback = <Figure kit={ME} accent="#0c1400" skin="#d8a87f" numberTex={num} />;
  return (
    <group ref={ref} scale={0.92}>
      <ModelBoundary fallback={fallback}><Suspense fallback={null}><OchiFigure keepMaterial={KIT_MAT} tint={ME} spin={FACE_GOAL} role="taker" play={play} clock={clock} /></Suspense></ModelBoundary>
    </group>
  );
}

function Keeper({ play, clock }: { play: Play; clock: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  const num = useMemo(() => kitNumberTexture("1", "#f0ecff", "#5b3fb0"), []);
  const [dive, setDive] = useState<{ col: PenColumn; t: number; high: boolean } | null>(null);
  useFrame(() => {
    if (!ref.current) return;
    const g = ref.current;
    const t = clock.current;
    if (play) {
      // The bones reach (REACH/CATCH); the group slides + tips the body toward the
      // dive side so the reach becomes a full horizontal save.
      const col = play.dive;
      const high = zoneRow(play.shot) === 2 && play.outcome === "saved";
      const k = THREE.MathUtils.clamp((t - 0.28) / 0.42, 0, 1);
      const e = k * k * (3 - 2 * k);
      const tx = col === 0 ? -2.4 : col === 2 ? 2.4 : 0;
      const ty = (col === 1 ? 0.05 : 0.6) + (high ? 0.5 : 0);
      const roll = col === 0 ? 1.2 : col === 2 ? -1.2 : 0;
      g.position.set(THREE.MathUtils.lerp(0, tx, e), THREE.MathUtils.lerp(0, ty, e), GOAL.z + 0.35);
      g.rotation.set(0, FACE_SHOOTER, THREE.MathUtils.lerp(0, roll, e));
      if (!dive) setDive({ col, t: k, high });
    } else {
      const bob = Math.sin(performance.now() / 380) * 0.04;
      g.position.set(0, bob, GOAL.z + 0.35);
      g.rotation.set(0, FACE_SHOOTER, 0);
      if (dive) setDive(null);
    }
  });
  const fallback = <Figure kit={OPP} accent="#f0ecff" skin="#caa07e" numberTex={num} dive={dive} />;
  return (
    <group ref={ref}>
      <ModelBoundary fallback={fallback}><Suspense fallback={null}><OchiFigure keepMaterial={KIT_MAT} tint={OPP} spin={FACE_SHOOTER} role="keeper" play={play} clock={clock} /></Suspense></ModelBoundary>
    </group>
  );
}

function GameBall({ play, clock, onPlayed, ballTex, reduced }: {
  play: Play; clock: React.MutableRefObject<number>;
  onPlayed: () => void; ballTex: THREE.Texture; reduced: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const done = useRef(false);
  const target = useMemo(() => (play ? zoneTarget(play.shot, play.outcome) : null), [play]);
  if (!play) done.current = false;
  useFrame((_, dt) => {
    if (!ref.current) return;
    const b = ref.current;
    if (play && target) {
      clock.current += dt;
      const FLIGHT = reduced ? 0.001 : 0.7;
      const t0 = 0.26; // strike contact
      if (clock.current < t0) {
        b.position.copy(SPOT);
      } else {
        const k = THREE.MathUtils.clamp((clock.current - t0) / FLIGHT, 0, 1);
        b.position.set(
          THREE.MathUtils.lerp(SPOT.x, target.x, k),
          THREE.MathUtils.lerp(SPOT.y, target.y, k) + Math.sin(k * Math.PI) * 1.1,
          THREE.MathUtils.lerp(SPOT.z, target.z, k)
        );
        b.rotation.x -= dt * 14; b.rotation.y -= dt * 7;
        if (k >= 1 && !done.current) { done.current = true; setTimeout(onPlayed, reduced ? 200 : 750); }
      }
    } else {
      clock.current = 0;
      b.position.copy(SPOT);
      b.rotation.set(0, 0, 0);
    }
  });
  return (
    <mesh ref={ref} position={SPOT} castShadow>
      <sphereGeometry args={[0.16, 24, 24]} />
      <meshStandardMaterial map={ballTex} roughness={0.35} metalness={0.02} />
    </mesh>
  );
}

/** Pulsing aim reticle on the goal mouth at the selected zone. */
function Reticle({ aim, color }: { aim: PenZone | null; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const s = 1 + Math.sin(performance.now() / 220) * 0.08;
    ref.current.scale.setScalar(s);
  });
  if (aim === null) return null;
  const p = zoneTarget(aim, "goal");
  return (
    <group ref={ref} position={[p.x, p.y, GOAL.z + 0.5]}>
      <mesh><ringGeometry args={[0.28, 0.36, 32]} /><meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh><ringGeometry args={[0.07, 0.1, 24]} /><meshBasicMaterial color={color} /></mesh>
    </group>
  );
}

function Rig() {
  const { camera } = useThree();
  useMemo(() => {
    camera.position.set(0.45, 2.55, 7.7);
    camera.lookAt(-0.15, 0.85, GOAL.z + 1);
  }, [camera]);
  return null;
}

export default function PenaltyScene3D({ aim, play, onPlayed, reduced }: {
  aim: PenZone | null;
  play: Play;
  onPlayed: () => void;
  reduced: boolean;
}) {
  const tex = useTextures();
  const clock = useRef(0);
  // reset the shared animation clock whenever a new play starts
  useEffect(() => { clock.current = 0; }, [play]);
  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 42, near: 0.1, far: 120, position: [0.45, 2.55, 7.7] }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <color attach="background" args={["#05060d"]} />
      <fog attach="fog" args={["#0a0f1c", 22, 70]} />
      <Rig />
      <Floodlights />
      <Environment grass={tex.grass} crowd={tex.crowd} net={tex.net} />
      {/* GLB figures suspend while loading — keep them in a boundary so the rest of
          the scene renders immediately and the model pops in when ready. */}
      <Suspense fallback={null}>
        <Taker play={play} clock={clock} />
        <Keeper play={play} clock={clock} />
      </Suspense>
      <GameBall play={play} clock={clock} onPlayed={onPlayed} ballTex={tex.ball} reduced={reduced} />
      <Reticle aim={aim} color={ME} />
      {!reduced && (
        <EffectComposer>
          <Bloom intensity={0.42} luminanceThreshold={0.78} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette eskil={false} offset={0.28} darkness={0.78} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
