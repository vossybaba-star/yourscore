/**
 * Client-safe types for the WC quiz flows. Deliberately NO imports — the actual
 * question pool (with answers) lives in wc-quiz.ts, which is server-only
 * (audit C1). Clients receive questions over the wire with `correctIndex: -1`
 * and learn the real index only after answering.
 */

/** A question as the client holds it. correctIndex is -1 until graded. */
export type ServedQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  category: string;
};
