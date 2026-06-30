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
