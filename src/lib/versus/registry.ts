// The versus registry (Approach C): the single place games declare how they show
// up in the Versus tab's game-first picker. Thin config only — the actual match
// flows (quiz async, 38-0 live) stay where they are. Add a game = add an entry.

export type OpponentMode = "friend" | "group" | "open" | "link";

export interface VersusGame {
  id: "quiz" | "38-0";
  label: string;
  tagline: string; // one-line under the card
  accent: string; // brand hex (teal = quiz, lime = 38-0)
  iconKey: "quiz" | "jersey";
  opponentModes: OpponentMode[];
}

// How each opponent mode routes, per game. Returns an in-app href. Kept here so
// the picker stays declarative and a new game wires its routes in one place.
export const OPPONENT_ROUTES: Record<VersusGame["id"], Partial<Record<OpponentMode, { label: string; href: string; sub: string }>>> = {
  quiz: {
    friend: { label: "Challenge a friend", href: "/friends", sub: "Pick a mate, beat their score" },
    group: { label: "Start a group board", href: "/play", sub: "Play a quiz, then invite the group" },
    open: { label: "Public lobby", href: "/play/new", sub: "Host or join an open game" },
    link: { label: "Share a link", href: "/play", sub: "Anyone with the link can play" },
  },
  "38-0": {
    friend: { label: "Play a friend", href: "/38-0/live", sub: "Live Draft XI match" },
    open: { label: "Find an opponent", href: "/38-0/live", sub: "Get matched with someone online" },
  },
};

// In-app marketing tiles for the Versus tab. Benefit-led, one CTA each, plain
// fan voice (say "friend", not "mate"). Edit/reorder here — the tab just maps.
export interface VersusPromo {
  id: string;
  title: string;
  sub: string;
  cta: string;
  href: string;
  accent: string; // teal = quiz-flavoured, lime = 38-0
  iconKey: "quiz" | "jersey" | "group" | "globe";
}

export const VERSUS_PROMOS: VersusPromo[] = [
  { id: "challenge-friend", title: "Challenge a friend", sub: "Pick a quiz, fire them your score and see if they can beat it.", cta: "Choose a friend", href: "/friends", accent: "#00d8c0", iconKey: "quiz" },
  { id: "play-38-0", title: "Take someone on at 38-0", sub: "Draft your XI and go head-to-head, live.", cta: "Find a match", href: "/38-0/live", accent: "#aeea00", iconKey: "jersey" },
  { id: "start-group", title: "Get the group involved", sub: "One quiz, the whole group, one leaderboard to settle it.", cta: "Start a group", href: "/play", accent: "#00d8c0", iconKey: "group" },
  { id: "play-open", title: "Play someone new", sub: "Jump into an open game and take on whoever's about.", cta: "Find a game", href: "/play/new", accent: "#00d8c0", iconKey: "globe" },
];

export const VERSUS_GAMES: VersusGame[] = [
  {
    id: "quiz",
    label: "Quiz",
    tagline: "1v1 · group · open",
    accent: "#00d8c0",
    iconKey: "quiz",
    opponentModes: ["friend", "group", "open", "link"],
  },
  {
    id: "38-0",
    label: "38-0",
    tagline: "live match",
    accent: "#aeea00",
    iconKey: "jersey",
    opponentModes: ["friend", "open"],
  },
];
