/**
 * News-feed DOC SHAPE — the read side only.
 *
 * These interfaces are the contract of the `fantasy_news_feed.doc` column: the
 * fantasy news-hub cron WRITES a doc of this shape; the Matchweek → PL → News
 * tab READS it. They live here, split out of `news.ts`, so the render path
 * (the <NewsFeed> component + the /api/pl/news route) can depend on the doc
 * shape WITHOUT dragging in the whole fantasy builder (pool → engine → pool.json,
 * tips, values) that news.ts value-imports. That keeps this branch free of the
 * fantasy backend while still rendering the real feed.
 *
 * When the fantasy branch merges, its `news.ts` can re-export from here to
 * dedupe — these definitions are copied verbatim from it, so the shapes match.
 */

export type Difficulty = "kind" | "medium" | "tough";

export interface NewsTickerCell {
  gw: number;
  opponent: string;
  oppShort: string;
  home: boolean;
  difficulty: Difficulty;
}

export interface NewsClubRun {
  clubId: number;
  club: string;
  short: string;
  cells: NewsTickerCell[];
}

export interface NewsDoubt { smId: number; name: string; club: string; reason: string }
export interface NewsClubXI { club: string; clubId: number; xi: { smId: number; name: string }[] }

export interface NewsItem {
  kind: "article" | "tweet";
  /** article: {title,url,image?,source} · tweet: {text,author,handle,url,image?} */
  payload: Record<string, string>;
  createdAt: string;
}

export interface NewsFormRow { playerId: number; name: string; club: string; pos: string; line: string; points: number }

export interface NewsInsight {
  kind: "form" | "fixture-swing";
  title: string;
  body: string;
}

export interface NewsTips {
  captain?: { player: string; why: string };
  differential?: { player: string; why: string };
  note?: string;
  draftedAt?: string;
}

export interface NewsDoc {
  gw: number;
  deadline: string | null;
  builtAt: string;
  fixtures: { gws: number[]; runs: NewsClubRun[]; updatedAt: string };
  teamNews: { predicted: NewsClubXI[]; doubts: NewsDoubt[]; items: NewsItem[]; updatedAt: string };
  form: { rows: NewsFormRow[]; updatedAt: string };
  insights: { items: NewsInsight[]; updatedAt: string };
  transfers: { items: NewsItem[]; updatedAt: string };
  tips: NewsTips & { gw?: number; updatedAt?: string; issue?: string };
}
