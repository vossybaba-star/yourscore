import type { Metadata } from "next";
import Link from "next/link";
import { WaitlistCard } from "@/components/blog/WaitlistCard";
import { getAllPosts, formatPostDate, SITE_URL } from "@/lib/blog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog | YourScore",
  description:
    "Football knowledge, quizzes and fan debates from YourScore — the football competition platform. Prove what you know, then put a score on it.",
  alternates: {
    canonical: `${SITE_URL}/blog`,
    types: { "application/rss+xml": `${SITE_URL}/blog/rss.xml` },
  },
  openGraph: {
    title: "The YourScore Blog",
    description:
      "Football knowledge, quizzes and fan debates from YourScore — the football competition platform.",
    type: "website",
    siteName: "YourScore",
    url: `${SITE_URL}/blog`,
    images: [
      {
        url: `${SITE_URL}/api/og/blog?title=${encodeURIComponent("The YourScore Blog")}`,
        width: 1200,
        height: 630,
        alt: "The YourScore Blog",
      },
    ],
  },
  twitter: { card: "summary_large_image" },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="pt-10">
      <p className="font-body text-xs font-semibold tracking-[0.2em] text-teal uppercase">
        Football knowledge, settled
      </p>
      <h1 className="font-display text-5xl tracking-wide text-text-primary mt-2">
        THE YOURSCORE BLOG
      </h1>
      <p className="font-body text-sm text-text-muted mt-3 max-w-md leading-6">
        Quizzes, records, debates and the stories behind them — written for fans who back
        themselves to know the game.
      </p>

      <div className="mt-10 space-y-4">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="block rounded-2xl bg-surface border border-border p-5 hover:border-teal/40 hover:bg-surface-2 transition"
          >
            <div className="flex items-center gap-3 font-body text-xs text-text-muted">
              <time dateTime={post.date}>{formatPostDate(post.date)}</time>
              {post.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-md bg-teal/10 text-teal font-medium"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h2 className="font-display text-2xl tracking-wide text-text-primary mt-2">
              {post.title}
            </h2>
            <p className="font-body text-sm text-text-muted mt-1.5 leading-6">
              {post.description}
            </p>
            <span className="inline-block font-body text-xs font-semibold text-lime mt-3">
              Read the post →
            </span>
          </Link>
        ))}
        {posts.length === 0 && (
          <p className="font-body text-sm text-text-muted">First posts landing shortly.</p>
        )}
      </div>

      {/* Launch capture — every reader gets a way onto the fantasy waitlist. */}
      <div className="mt-10">
        <WaitlistCard />
      </div>
    </div>
  );
}
