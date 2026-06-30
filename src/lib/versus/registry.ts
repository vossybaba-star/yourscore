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

// The Versus feed: an image-led, scrollable discovery surface. One hero, then
// rich image-backed action cards. Benefit-led, one CTA each, plain fan voice
// (say "friend", not "mate"). `image` is a static asset in public/. Edit/reorder
// here — the tab just maps.
export interface VersusFeedItem {
  id: string;
  kind: "hero" | "card";
  title: string;
  sub: string;
  cta: string;
  href: string;
  accent: string; // teal = quiz-flavoured, lime = 38-0
  image: string; // public/ path
  iconKey: "quiz" | "jersey" | "group" | "globe";
}

export const VERSUS_FEED: VersusFeedItem[] = [
  { id: "daily", kind: "hero", title: "World Cup Mastermind", sub: "The daily ranked run — top the board, win £100", cta: "Play today's", href: "/38-0/wc?daily=1", accent: "#ffc233", image: "/email/wc-banner.jpg", iconKey: "jersey" },
  { id: "challenge-friend", kind: "card", title: "Challenge a friend", sub: "Pick a quiz, send your score, see if they can beat it.", cta: "Challenge a friend", href: "/versus/challenge", accent: "#00d8c0", image: "/email/h2h-gameplay.png", iconKey: "quiz" },
  { id: "play-38-0", kind: "card", title: "Take someone on at 38-0", sub: "Draft your XI and go head-to-head, live.", cta: "Find a match", href: "/38-0/live", accent: "#aeea00", image: "/email/wc-draft.png", iconKey: "jersey" },
  { id: "leagues", kind: "card", title: "Start a league with your mates", sub: "An ongoing table that settles who really knows their football.", cta: "Go to leagues", href: "/versus?view=leagues", accent: "#00d8c0", image: "/email/wc-leaderboard.png", iconKey: "group" },
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
