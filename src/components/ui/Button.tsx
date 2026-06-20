"use client";

import Link from "next/link";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";

/**
 * The one primary-action button for the whole app.
 *
 * Wraps the visual-refresh button vocabulary (.btn-ticket / .btn-ghost in
 * globals.css) so screens stop hand-rolling inline styles — which is exactly
 * why radius, padding, font and colour drifted everywhere.
 *
 *   variant  primary  → layered "ticket" CTA (the bold one)
 *            ghost    → transparent + hairline border (secondary)
 *            danger   → destructive (delete / leave)
 *   tone     lime     → 38-0 / general actions (default)
 *            teal     → Quiz / knowledge
 *            gold     → wins only (result celebrations) — primary variant only
 *   size     sm / md / lg  → consistent padding + label size
 *
 * Pass `href` to render a Link, otherwise it's a <button>. `fullWidth` stretches
 * it. Everything else (onClick, disabled, type, aria-*) flows straight through.
 */
type Variant = "primary" | "ghost" | "danger";
type Tone = "lime" | "teal" | "gold";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  sm: "px-4 py-2.5 text-[15px]",
  md: "px-5 py-3.5 text-lg",
  lg: "px-6 py-4 text-xl",
};

function classesFor(variant: Variant, tone: Tone, size: Size, fullWidth: boolean): string {
  const width = fullWidth ? "w-full justify-center" : "";
  const sz = SIZES[size];

  if (variant === "primary") {
    const toneCls = tone === "teal" ? "btn-ticket--teal" : tone === "gold" ? "btn-ticket--gold" : "";
    return `btn-ticket ${toneCls} ${sz} ${width}`.trim();
  }
  if (variant === "danger") {
    // Ghost shell, danger ink + border — reads destructive without shouting.
    return `btn-ghost ${sz} ${width} !border-[rgba(255,71,87,0.4)] !text-danger`.trim();
  }
  // ghost (secondary)
  return `btn-ghost ${sz} ${width}`.trim();
}

interface CommonProps {
  variant?: Variant;
  tone?: Tone;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof CommonProps> & { href?: undefined };
type ButtonAsLink = CommonProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, keyof CommonProps> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(
    { variant = "primary", tone = "lime", size = "md", fullWidth = false, className = "", children, ...rest },
    ref
  ) {
    const cls = `${classesFor(variant, tone, size, fullWidth)} ${className}`.trim();

    if ("href" in rest && rest.href != null) {
      const { href, ...linkRest } = rest as ButtonAsLink;
      return (
        <Link ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={cls} {...linkRest}>
          {children}
        </Link>
      );
    }

    const { type, ...btnRest } = rest as ButtonAsButton;
    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} type={type ?? "button"} className={cls} {...btnRest}>
        {children}
      </button>
    );
  }
);
