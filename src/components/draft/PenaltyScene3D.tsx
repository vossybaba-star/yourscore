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
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { zoneColumn, zoneRow, type KickOutcome, type PenColumn, type PenZone } from "@/lib/draft/pens";

// ── Pitch / goal geometry (world units ≈ metres) ───────────────────────────────
const GOAL = { w: 7.32, h: 2.44, z: -9, postR: 0.07 };
const SPOT = new THREE.Vector3(0, 0.12, 2.2);
const COL_X = [-GOAL.w / 2 + 1.35, 0, GOAL.w / 2 - 1.35]; // L / C / R aim columns
const ROW_Y = [0.55, 1.32, 2.05];                          // low / mid / high

const ME = "#b4ff2e";

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

function Striker({ play, clock }: { play: Play; clock: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  const num = useMemo(() => kitNumberTexture("7", ME, "#0c0c12"), []);
  useFrame(() => {
    if (!ref.current) return;
    const g = ref.current;
    // run-up + kick lunge in the first 0.32s of a play, then settle.
    let lean = 0, fwd = 0;
    if (play && play.side === "me") {
      const t = clock.current;
      if (t < 0.34) { const k = t / 0.34; fwd = Math.sin(k * Math.PI) * 0.5; lean = Math.sin(k * Math.PI) * 0.5; }
    }
    g.position.set(-0.92 + fwd * 0.5, 0, SPOT.z + 0.6 - fwd * 0.7);
    g.rotation.set(lean * 0.32, 0.2, 0);
  });
  return <group ref={ref} scale={0.86}><Figure kit="#0e0e14" accent={ME} skin="#d8a87f" numberTex={num} /></group>;
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
      // commit the dive at t≈0.3 (after the strike), lerp to the dive pose by t≈0.7
      const col = play.dive;
      const high = zoneRow(play.shot) === 2 && play.outcome === "saved";
      const k = THREE.MathUtils.clamp((t - 0.28) / 0.42, 0, 1);
      const tx = col === 0 ? -2.3 : col === 2 ? 2.3 : 0;
      const ty = (col === 1 ? 0.0 : 0.45) + (high ? 0.7 : 0) ;
      const rot = col === 0 ? 0.9 : col === 2 ? -0.9 : 0;
      g.position.set(THREE.MathUtils.lerp(0, tx, k), THREE.MathUtils.lerp(0, ty, k), GOAL.z + 0.35);
      g.rotation.set(0, Math.PI, THREE.MathUtils.lerp(0, rot, k));
      if (!dive) setDive({ col, t: k, high });
    } else {
      // idle: small ready bob
      const bob = Math.sin(performance.now() / 380) * 0.04;
      g.position.set(0, bob, GOAL.z + 0.35);
      g.rotation.set(0, Math.PI, 0);
      if (dive) setDive(null);
    }
  });
  return <group ref={ref}><Figure kit="#5b3fb0" accent="#c9b6ff" skin="#caa07e" numberTex={num} dive={dive} /></group>;
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
      <Striker play={play} clock={clock} />
      <Keeper play={play} clock={clock} />
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
