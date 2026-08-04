/**
 * Client-safe shapes for a shared Scout rating (/r/[id]).
 *
 * Kept free of `server-only` and of any squadRating.ts import (that file is
 * server-only) so the client view AND the server page/card can all import
 * these. The stored `rating` jsonb is a RatingResponse, which is a structural
 * superset of RatingView here — reading it back as RatingView drops the fields
 * the share surfaces never use (subScores, copySource, timestamps).
 */
import type { RatingBandsShape } from "@/components/fantasy/RatingBands";

export interface HorizonView {
  score: number;
  verdict: string;
  bands: RatingBandsShape;
  moveLine: string;
}

export interface RatingView {
  month: HorizonView;
  season: HorizonView;
}

/** One of the 15 as stored on the snapshot — enough to draw the pitch and
 *  carry the exact XI into the builder, without a live pool read. */
export interface RateSharePlayer {
  id: number;
  name: string;
  pos: string;
  club: string;
  isBench: boolean;
  isCaptain: boolean;
  isVice: boolean;
}

export interface RateShareRow {
  id: string;
  rating: RatingView;
  players: RateSharePlayer[];
  source: string | null;
  createdAt: string;
}
