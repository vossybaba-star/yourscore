import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// Shared helpers for Club Leagues (partner-owned branded leagues).
// Spec: docs/superpowers/specs/2026-06-12-club-leagues-design.md
// All reads/writes here run via the service role — callers are the /api/club/*
// routes, which do their own auth/membership checks before mutating.

export type ClubLeague = Database["public"]["Tables"]["club_leagues"]["Row"];
export type ClubEvent = Database["public"]["Tables"]["club_league_events"]["Row"];

// Branding-only projection safe to show anyone (the public landing page).
export const PUBLIC_LEAGUE_COLS =
  "id, slug, name, tier, logo_url, cover_url, brand_color, welcome_text, prize_text, is_active";

// Columns a partner (owner) may edit. slug / tier / is_active / owner_id are
// admin-only: slugs are printed on posters, the rest are commercial controls.
export const OWNER_EDITABLE_COLS = [
  "name",
  "logo_url",
  "cover_url",
  "brand_color",
  "welcome_text",
  "prize_text",
  "announcement",
] as const;

export function eventWindowState(
  e: Pick<ClubEvent, "starts_at" | "ends_at" | "status">,
  now: Date = new Date()
): "cancelled" | "upcoming" | "live" | "ended" {
  if (e.status === "cancelled") return "cancelled";
  if (now < new Date(e.starts_at)) return "upcoming";
  if (now >= new Date(e.ends_at)) return "ended";
  return "live";
}

export async function getLeagueBySlug(slug: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("club_leagues")
    .select("*")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  return data;
}

export async function getMembership(leagueId: string, userId: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("club_league_members")
    .select("role")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  return data; // null = not a member
}

const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

export function makeJoinCode(len = 6): string {
  let code = "";
  for (let i = 0; i < len; i++) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}
