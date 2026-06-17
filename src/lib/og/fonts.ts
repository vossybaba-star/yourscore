/**
 * Brand fonts for next/og cards. The app's identity is **Bebas Neue** (the
 * condensed athletic caps of the logo / all display headers) over **DM Sans**
 * (body) — see tailwind.config.ts fontFamily + app/layout.tsx. Satori doesn't
 * read CSS fonts, so we load the real TTFs and hand them to ImageResponse.
 *
 * Files are fetched via `import.meta.url` (the asset is bundled with the route,
 * reliable on Vercel edge) and cached for the lifetime of the lambda.
 */

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

let cache: OgFont[] | null = null;

export async function loadBrandFonts(): Promise<OgFont[]> {
  if (cache) return cache;
  const [bebas, dmRegular, dmBold] = await Promise.all([
    fetch(new URL("./fonts/BebasNeue-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("./fonts/DMSans-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("./fonts/DMSans-Bold.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);
  cache = [
    { name: "Bebas Neue", data: bebas, weight: 400, style: "normal" },
    { name: "DM Sans", data: dmRegular, weight: 400, style: "normal" },
    { name: "DM Sans", data: dmBold, weight: 700, style: "normal" },
  ];
  return cache;
}
