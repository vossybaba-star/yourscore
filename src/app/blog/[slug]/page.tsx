import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote, type MDXRemoteProps } from "next-mdx-remote/rsc";
import { EmbeddedTweet, TweetNotFound } from "react-tweet";
import { getTweet } from "react-tweet/api";
import { getAllPosts, getPost, formatPostDate, SITE_URL } from "@/lib/blog";
import { WaitlistCard } from "@/components/blog/WaitlistCard";

// Tweets render to static HTML at build time (react-tweet RSC) — no Twitter
// scripts ship to the reader. A deleted/unfetchable tweet degrades to a quiet
// fallback rather than failing the build.
async function StaticTweet({ id }: { id: string }) {
  try {
    const tweet = await getTweet(id);
    if (!tweet) return <TweetNotFound />;
    return (
      <div className="my-6 flex justify-center [&_.react-tweet-theme]:!my-0" data-theme="dark">
        <EmbeddedTweet tweet={tweet} />
      </div>
    );
  } catch {
    return null;
  }
}

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPost(params.slug);
  if (!post) return {};

  const url = `${SITE_URL}/blog/${post.slug}`;
  const ogImage =
    post.ogImage ?? `${SITE_URL}/api/og/blog?title=${encodeURIComponent(post.title)}`;

  return {
    title: `${post.title} | YourScore`,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      siteName: "YourScore",
      url,
      publishedTime: post.date,
      tags: post.tags,
      images: [{ url: ogImage, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

/**
 * Tables in posts are authored as <DataTable head={[...]} rows={[[...]]} />.
 *
 * Two things force this: GitHub pipe tables need remark-gfm (npm currently can't
 * add a dependency to this tree), and the `components` map does NOT reach raw
 * <table> HTML written into MDX — only capitalised components and
 * markdown-generated elements get mapped, so hand-written HTML renders unstyled.
 * The wrapper scrolls horizontally so a wide table never makes the page scroll.
 */
function DataTable({ data }: { data: string }) {
  // Data arrives as a JSON STRING attribute, not {expression} props: this MDX
  // pipeline evaluates plain string attributes (same as <Tweet id="…" />) but not
  // braced expressions, which silently arrive as undefined.
  let head: string[] = [];
  let rows: string[][] = [];
  try {
    const parsed = JSON.parse(data) as { head?: string[]; rows?: string[][] };
    head = parsed.head ?? [];
    rows = parsed.rows ?? [];
  } catch {
    return null;
  }
  if (head.length === 0 || rows.length === 0) return null;

  return (
    <div className="my-6 overflow-x-auto rounded-xl border border-border bg-surface-1">
      <table className="w-full border-collapse font-body text-[15px] text-[#c4ccc6]">
        <thead>
          <tr className="bg-white/[0.04]">
            {head.map((cell) => (
              <th
                key={cell}
                className="border-b border-border px-4 py-3 text-left font-display text-sm tracking-wide text-text-primary"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-b-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-3 align-top leading-6 ${j === 0 ? "font-semibold text-text-primary whitespace-nowrap" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Editorial styling for MDX output — the app has no typography plugin, so each
// element is mapped explicitly to the house look (Bebas headings, DM Sans body).
const mdxComponents: MDXRemoteProps["components"] = {
  Tweet: StaticTweet,
  h1: (props) => (
    <h2 className="font-display text-3xl tracking-wide text-text-primary mt-10 mb-3" {...props} />
  ),
  h2: (props) => (
    <h2 className="font-display text-3xl tracking-wide text-text-primary mt-10 mb-3" {...props} />
  ),
  h3: (props) => (
    <h3 className="font-display text-xl tracking-wide text-text-primary mt-8 mb-2" {...props} />
  ),
  p: (props) => <p className="font-body text-[15px] leading-7 text-[#c4ccc6] mb-5" {...props} />,
  a: (props) => (
    <a className="text-teal underline underline-offset-2 hover:brightness-110" {...props} />
  ),
  ul: (props) => (
    <ul className="list-disc pl-5 mb-5 space-y-2 font-body text-[15px] leading-7 text-[#c4ccc6]" {...props} />
  ),
  ol: (props) => (
    <ol className="list-decimal pl-5 mb-5 space-y-2 font-body text-[15px] leading-7 text-[#c4ccc6]" {...props} />
  ),
  blockquote: (props) => (
    <blockquote
      className="border-l-2 border-gold pl-4 my-6 font-body text-[15px] leading-7 text-text-primary italic"
      {...props}
    />
  ),
  strong: (props) => <strong className="font-semibold text-text-primary" {...props} />,
  code: (props) => (
    <code className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-surface-2 text-teal" {...props} />
  ),
  hr: () => <hr className="border-border my-8" />,
  DataTable,
  img: (props) => (
    // Author-supplied images in MDX come with unknown dimensions; plain <img> keeps it simple.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="rounded-xl border border-border my-6 max-w-full" alt="" {...props} />
  ),
};

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  // FAQPage schema is only emitted when the FAQ is actually rendered below —
  // Google requires the marked-up Q&As to be visible on the page.
  const faqJsonLd =
    post.faq.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faq.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }
      : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    url: `${SITE_URL}/blog/${post.slug}`,
    image:
      post.ogImage ?? `${SITE_URL}/api/og/blog?title=${encodeURIComponent(post.title)}`,
    author: { "@type": "Organization", name: "YourScore", url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "YourScore",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
    ...(post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
  };

  // Breadcrumbs give Google the Home > Blog > Post trail it shows under the result
  // instead of a bare URL. Mirrors the "← All posts" link that's actually on the page.
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "YourScore", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
        item: `${SITE_URL}/blog/${post.slug}`,
      },
    ],
  };

  return (
    <article className="pt-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}

      <Link href="/blog" className="font-body text-xs font-semibold text-text-muted hover:text-text-primary transition">
        ← All posts
      </Link>

      <header className="mt-6">
        <div className="flex items-center gap-3 font-body text-xs text-text-muted">
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          {post.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-md bg-teal/10 text-teal font-medium">
              {tag}
            </span>
          ))}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl tracking-wide text-text-primary mt-3 leading-tight">
          {post.title}
        </h1>
        <p className="font-body text-base text-text-muted mt-3 leading-7">{post.description}</p>
      </header>

      <div className="mt-8 border-t border-border pt-8">
        <MDXRemote source={post.content} components={mdxComponents} />
      </div>

      {/* Launch capture — the funnel's bottom (content audit: four posts sold a
          mid-August launch with no way to leave an email). */}
      <section className="mt-10">
        <WaitlistCard />
      </section>

      {post.faq.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-3xl tracking-wide text-text-primary mb-4">
            QUICK ANSWERS
          </h2>
          <div className="space-y-3">
            {post.faq.map((item) => (
              <details
                key={item.q}
                className="rounded-2xl bg-surface border border-border px-5 py-4 group"
              >
                <summary className="font-body text-[15px] font-semibold text-text-primary cursor-pointer list-none flex items-center justify-between gap-3">
                  {item.q}
                  <span className="text-text-muted group-open:rotate-45 transition-transform" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="font-body text-[15px] leading-7 text-[#c4ccc6] mt-3">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
