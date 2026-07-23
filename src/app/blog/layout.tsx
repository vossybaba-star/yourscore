import Link from "next/link";
import Image from "next/image";

/**
 * Shared shell for all /blog pages — public, logged-out friendly, static.
 * Header links back into the app; footer carries the single conversion CTA.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="pt-safe border-b border-border bg-bg/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-2xl px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="YourScore home" className="flex items-center">
              <Image src="/logo.png" alt="YourScore" width={101} height={30} priority />
            </Link>
            <span className="text-text-muted" aria-hidden>
              /
            </span>
            <Link href="/blog" className="font-display text-lg tracking-wider text-text-primary">
              BLOG
            </Link>
          </div>
          <Link
            href="/"
            className="font-body text-xs font-semibold px-3.5 py-2 rounded-lg text-black bg-lime hover:brightness-110 transition"
          >
            Play free
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-16">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-2xl px-5 py-10">
          <div className="rounded-2xl bg-surface border border-border p-6 text-center">
            <h2 className="font-display text-3xl tracking-wide text-text-primary">
              THINK YOU KNOW YOUR FOOTBALL?
            </h2>
            <p className="font-body text-sm text-text-muted mt-2">
              Put a score on it. Daily quizzes, 38-0, and head-to-head games with your friends —
              free at yourscore.app.
            </p>
            <Link
              href="/"
              className="inline-block mt-5 font-body text-sm font-bold px-6 py-3 rounded-xl text-black bg-lime hover:brightness-110 transition"
            >
              Play YourScore
            </Link>
          </div>
          <div className="flex items-center justify-center gap-5 mt-8 font-body text-xs text-text-muted">
            <Link href="/games" className="hover:text-text-primary transition">
              Games
            </Link>
            <Link href="/privacy" className="hover:text-text-primary transition">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-text-primary transition">
              Terms
            </Link>
            <a href="/blog/rss.xml" className="hover:text-text-primary transition">
              RSS
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
