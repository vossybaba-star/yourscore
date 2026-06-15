import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces — deep "pitch → ink" ramp (de-violeted; was blue-violet greys)
        bg: "#080d0a",
        surface: "#0e1611",
        "surface-2": "#15211a",
        "surface-3": "#1d2c23",
        // Brand system: lime = 38-0/energy/actions, teal = Quiz/knowledge, gold = wins only
        lime: "#aeea00",
        teal: "#00d8c0",
        gold: "#ffc233",
        // `green` kept as an alias so existing bg-green/text-green pick up the new
        // action colour (lime) without touching every usage site.
        green: "#aeea00",
        amber: "#ffb800",
        danger: "#ff4757",
        "text-primary": "#eef2f0",
        "text-muted": "#8a948f",
        border: "rgba(255,255,255,0.07)",
      },
      fontFamily: {
        display: ["var(--font-bebas)", "sans-serif"],
        body: ["var(--font-dm-sans)", "sans-serif"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
        "slide-up": "slideUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards",
        "fade-in": "fadeIn 0.2s ease forwards",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
    },
  },
  plugins: [],
};
export default config;
