# Blog authoring guide

One post = one `.mdx` file in this directory. Publishing = commit + deploy (main
auto-deploys via Vercel). The filename is the URL slug: `my-post.mdx` →
`yourscore.app/blog/my-post`.

## Frontmatter

```yaml
---
title: "Plain-language headline"            # required
description: "1–2 sentence summary"         # shown on the index card, meta description, RSS
date: "2026-07-09"                          # required, YYYY-MM-DD — controls ordering
tags: ["Premier League", "Quiz"]           # optional, shown as chips
ogImage: "https://.../custom.png"           # optional — omit for the branded typographic plate
draft: true                                 # true = invisible everywhere (index, sitemap, RSS, URL)
faq:                                        # optional — renders a "Quick answers" section AND
  - q: "Is YourScore free?"                 #   emits FAQPage JSON-LD for Google rich results
    a: "Yes — every game is free to play."
---
```

- A post missing `title` or `date` is skipped at build with a warning (it won't
  break the deploy).
- **FAQ goes in frontmatter, not the body.** One `faq:` list drives both the
  visible section and the schema, which keeps them in sync (Google requires the
  marked-up Q&As to be visible on the page). Do NOT paste FAQPage JSON-LD or
  `<!-- SEO -->` markers into the body.

## Body (MDX)

Standard markdown. Gotchas:

- **HTML comments (`<!-- ... -->`) break MDX builds.** Use `{/* ... */}` if you
  need an editorial note that shouldn't render.
- Headings inside the body start at `##` (the `#` H1 comes from `title`).
- House voice rules apply: full natural sentences, "football knowledge" never
  "IQ", the team-builder is "38-0", a pre-game grouping is a "Lobby".

## Checking your post

`npm run dev` locally and open `/blog/<slug>`, or mark it `draft: true`, deploy,
flip to `draft: false` when approved.
