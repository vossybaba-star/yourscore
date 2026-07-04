// Minimal comment moderation: block the obviously-hostile stuff at the door,
// soft-delete handles the rest (authors can remove their own; anything worse
// is a service-role admin job). Deliberately short — football banter is the
// point, so only slurs and abuse belong here, not swearing.

const BLOCKED = [
  // slurs / abuse — matched as substrings, lowercased
  "nigger", "nigga", "faggot", "tranny", "chink", "spastic", "retard",
  "kill yourself", "kys",
];

const LINK = /https?:\/\/|www\./i;

/** Null when the body is fine; a user-facing reason otherwise. */
export function commentRejection(body: string): string | null {
  const text = body.toLowerCase();
  if (BLOCKED.some((w) => text.includes(w))) return "Keep it football — that language isn't welcome here.";
  if (LINK.test(body)) return "No links in comments.";
  return null;
}
