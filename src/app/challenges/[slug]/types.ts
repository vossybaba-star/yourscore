// Shared types for the challenge quiz page and its split-out phases
// (page.tsx = intro/playing, ResultsView.tsx = results). Pulled into their
// own file so ResultsView.tsx doesn't have to import from page.tsx itself
// (page.tsx dynamic-imports ResultsView — importing back from ResultsView
// to page.tsx would be a circular module reference).

export interface QuizPack {
  id: string;
  name: string;
  type: string;
  parameter: string;
  question_count: number;
  description?: string | null;
  metadata?: {
    icon?: string;
    cover_image?: string;
    series?: string;
    daily?: boolean;
    date?: string;
    // Present only on halftime packs (release engine writes it) — the fixture
    // linkage that powers the end-of-pack prediction poll. Only the Halftime
    // Prediction poll's own settlement bookkeeping still reads this key.
    halftime?: { fixture_id: number; home: string; away: string };
    // Present only on Gameday packs (publish engine writes it) — the fixture
    // linkage for the PRE-MATCH prediction poll shown at the end of an
    // attempt made before kickoff (§0.6). kickoff_at drives the "has this
    // fixture already kicked off" check.
    gameday?: { fixture_id: number; home: string; away: string; kickoff_at: string };
    // Present only on the pre-generated club topic packs (the /club/[slug] hub).
    // The category slug drives an honest label instead of "2025/26 Season Game".
    club_topic?: string;
  } | null;
}

// NO `answer` field — the pack route (/api/challenges/pack) strips it before
// this ever reaches the client. Grading + the correct-letter reveal come from
// /api/quiz/answer, one question at a time. Do not add `answer` back here; a
// future reader with a wider type would silently reopen the leak.
export interface RawQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  difficulty: string;
  category: string;
}

export interface AnswerRecord {
  idx: number;
  selected: Letter;
  correct: boolean;
  points: number;
  elapsed_ms: number;
}

export type Letter = "A" | "B" | "C" | "D";
