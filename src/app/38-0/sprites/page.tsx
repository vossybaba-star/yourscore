"use client";

/**
 * DEV-ONLY sprite spike (/38-0/sprites). Renders the StudioOchi players GLB at
 * bind pose and lets us rotate named bones to author clean strike / dive / catch
 * poses, then export them as transparent PNG sprites for the 2D shootout.
 * Not linked anywhere; guarded to development. Safe to delete once sprites bake.
 *
 * Drive from the console via `window.__sprite`:
 *   __sprite.only(1)                       // isolate player by mesh index (0..5), -1 = all
 *   __sprite.cam({az, el, dist, tx,ty,tz}) // orbit camera
 *   __sprite.bone('thigh.R', -1.4, 0, 0)   // set a bone's delta euler (radians)
 *   __sprite.pose({ 'thigh.R':[-1.4,0,0], 'shin.R':[0.6,0,0] })
 *   __sprite.reset()                       // back to bind pose
 *   __sprite.list()                        // all bone names
 *   __sprite.png()                         // canvas as data URL (transparent)
 */

import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const URL = "/models/players.glb";
const DEV = process.env.NODE_ENV === "development";

type Cam = { az: number; el: number; dist: number; tx: number; ty: number; tz: number };
type Deltas = Record<string, [number, number, number]>;

function Players({ only, deltas, tint, register }: {
  only: number; deltas: Deltas; tint: string | null; register: (names: string[]) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(URL);

  const { object, bones, bind } = useMemo(() => {
    const c = skeletonClone(scene) as THREE.Object3D;
    const bones = new Map<string, THREE.Bone>();
    const bind = new Map<string, THREE.Quaternion>();
    c.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const b = o as THREE.Bone;
        bones.set(b.name, b);
        bind.set(b.name, b.quaternion.clone());
      }
    });
    return { object: c, bones, bind };
  }, [scene]);

  // Isolate one player by mesh order.
  useMemo(() => {
    let i = 0;
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.visible = only < 0 || i === only;
      m.frustumCulled = false;
      i++;
    });
  }, [object, only]);

  useEffect(() => { register(Array.from(bones.keys())); }, [bones, register]);

  // Recolour the kit to ONE solid colour while keeping a realistic skin tone, hair
  // and boots. The atlas is a palette strip: skin is a warm band, hair/boots/outlines
  // are near-black, and the kit is everything else (incl. the striped "PLAYER 10"
  // region). We repaint the texture: keep skin + dark pixels, recolour the rest to the
  // team colour modulated by luminance (so folds still shade). tint=null restores it.
  useEffect(() => {
    let i = 0;
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const idx = i++;
      if (only >= 0 && idx !== only) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.userData._orig === undefined) mat.userData._orig = mat.map ?? null;
      const orig = mat.userData._orig as THREE.Texture | null;
      if (!tint) {
        mat.map = orig; mat.color.set(0xffffff); mat.needsUpdate = true; return;
      }
      const img = orig?.image as (HTMLImageElement | ImageBitmap | undefined);
      if (!img) { mat.color.set(tint); mat.map = null; mat.needsUpdate = true; return; }
      const cv = document.createElement("canvas");
      cv.width = (img as HTMLImageElement).width; cv.height = (img as HTMLImageElement).height;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(img as CanvasImageSource, 0, 0);
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      const px = data.data;
      const tc = new THREE.Color(tint);
      for (let p = 0; p < px.length; p += 4) {
        const r = px[p], g = px[p + 1], b = px[p + 2];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // Keep WARM tones (skin at any brightness + brown hair); recolour everything
        // else — the kit, neutral-black "PLAYER 10" text (→ kit colour, vanishes), and
        // accent bands. This drops the wordmark/number while preserving face + hair.
        const warm = r >= g && g >= b && r - b > 12;
        const isSkin = warm && r > 110 && g > 75 && r - b < 130;
        const isHair = warm && lum < 0.34;
        if (isSkin || isHair) continue;
        // Flat team colour (no texture-luminance modulation) so the kit reads as ONE
        // colour and the "PLAYER 10" text dissolves; the scene lights still shade the
        // body via the mesh normals, so it isn't flat-looking.
        px[p] = tc.r * 255;
        px[p + 1] = tc.g * 255;
        px[p + 2] = tc.b * 255;
      }
      ctx.putImageData(data, 0, 0);
      const ctex = new THREE.CanvasTexture(cv);
      if (orig) { ctex.flipY = orig.flipY; ctex.colorSpace = orig.colorSpace; ctex.wrapS = orig.wrapS; ctex.wrapT = orig.wrapT; }
      ctex.needsUpdate = true;
      mat.map = ctex; mat.color.set(0xffffff); mat.needsUpdate = true;
    });
  }, [object, tint, only]);

  // Apply pose deltas on top of the bind pose. Bones are named per-player with a
  // `_NN` node-index suffix (thighR_41, thighR_86, …); match by BASE name (suffix
  // stripped) so a single delta poses the visible player regardless of suffix.
  useEffect(() => {
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    bones.forEach((b, name) => {
      const base = name.replace(/_\d+$/, "");
      const bindQ = bind.get(name)!;
      const d = deltas[base] ?? deltas[name];
      if (d) {
        e.set(d[0], d[1], d[2]);
        q.setFromEuler(e);
        b.quaternion.copy(bindQ).multiply(q);
      } else {
        b.quaternion.copy(bindQ);
      }
    });
  }, [deltas, bones, bind]);

  return <primitive ref={group} object={object} />;
}

function Rig({ cam }: { cam: Cam }) {
  const { camera } = useThree();
  useEffect(() => {
    const { az, el, dist, tx, ty, tz } = cam;
    camera.position.set(tx + dist * Math.cos(el) * Math.sin(az), ty + dist * Math.sin(el), tz + dist * Math.cos(el) * Math.cos(az));
    camera.lookAt(tx, ty, tz);
  }, [camera, cam]);
  return null;
}

export default function SpriteSpike() {
  const [only, setOnly] = useState(1);
  const [deltas, setDeltas] = useState<Deltas>({});
  const [tint, setTint] = useState<string | null>(null);
  const [cam, setCam] = useState<Cam>({ az: 0, el: 0.05, dist: 4.2, tx: 0, ty: 1.0, tz: 0 });
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const namesRef = useRef<string[]>([]);

  useEffect(() => {
    if (!DEV) return;
    (window as unknown as { __sprite: unknown }).__sprite = {
      only: (i: number) => setOnly(i),
      cam: (c: Partial<Cam>) => setCam((p) => ({ ...p, ...c })),
      bone: (n: string, x: number, y: number, z: number) => setDeltas((p) => ({ ...p, [n]: [x, y, z] })),
      pose: (d: Deltas) => setDeltas(d),
      merge: (d: Deltas) => setDeltas((p) => ({ ...p, ...d })),
      reset: () => setDeltas({}),
      tint: (hex: string | null) => setTint(hex),
      list: () => namesRef.current,
      get: () => ({ only, deltas, cam }),
      png: () => glRef.current?.domElement.toDataURL("image/png"),
      save: async (name: string) => {
        const dataUrl = glRef.current?.domElement.toDataURL("image/png");
        const r = await fetch("/api/_sprite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, dataUrl }) });
        return r.json();
      },
    };
  }, [only, deltas, cam]);

  if (!DEV) return <div>nope</div>;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#202028" }}>
      <Canvas
        gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
        dpr={2}
        camera={{ fov: 32, near: 0.1, far: 100 }}
        onCreated={({ gl }) => { glRef.current = gl; gl.setClearColor(0x000000, 0); }}
        style={{ width: "100%", height: "100%" }}
      >
        <ambientLight intensity={1.15} />
        <directionalLight position={[3, 6, 4]} intensity={1.7} />
        <directionalLight position={[-3, 4, -2]} intensity={0.55} />
        <Rig cam={cam} />
        <Players only={only} deltas={deltas} tint={tint} register={(n) => { namesRef.current = n; }} />
      </Canvas>
      <div style={{ position: "absolute", top: 8, left: 8, color: "#fff", fontFamily: "monospace", fontSize: 12 }}>
        sprite spike — drive via window.__sprite
      </div>
    </div>
  );
}
useGLTF.preload(URL);
