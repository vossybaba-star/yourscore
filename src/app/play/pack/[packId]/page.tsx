import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { BackPill } from "@/components/ui/BackPill";
import { DiscussionThread } from "@/components/debate/DiscussionThread";
import { Button } from "@/components/ui/Button";
import { slugify } from "@/lib/utils";

// Standalone public thread page for a quiz pack's comments — the deep-link
// destination for a pack comment_like/comment_reply push or inbox row
// (/play/pack/<packId>?c=<commentId>), and the "Talk about this quiz" front
// door from the results screen. Public read, same as the debate page;
// DiscussionThread itself walks a signed-out visitor to sign-in on
// post/like/reply.
//
// SAFETY: quiz_packs.questions carries the answers. This page selects ONLY
// the columns below — never `questions`, never `select("*")`.
const PACK_COLS = "id, name, title, question_count, status";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface PackRow {
  id: string;
  name: string;
  title: string | null;
  question_count: number | null;
  status: string;
}

/** Published packs only. This page is PUBLIC, and drafts exist (Gameday packs
 *  are drafted before their fixture) — surfacing one would leak an unpublished
 *  title and offer a Play link the quiz API refuses. Mirrors the gate on the
 *  other public surfaces (api/challenges/pack, the home page). */
async function loadPack(packId: string): Promise<PackRow | null> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("quiz_packs")
    .select(PACK_COLS)
    .eq("id", packId)
    .eq("status", "published")
    .maybeSingle();
  return (data as unknown as PackRow) ?? null;
}

export async function generateMetadata({ params }: { params: { packId: string } }): Promise<Metadata> {
  const pack = await loadPack(params.packId).catch(() => null);
  const label = pack ? (pack.title ?? pack.name) : "This quiz";
  return {
    // No dashes in any user-facing copy, and metadata IS user facing: it lands
    // in the browser tab, share previews and search results.
    title: pack ? `${label} on YourScore` : "Quiz discussion on YourScore",
    description: "Talk about this quiz. See what other players thought and have your say.",
  };
}

export default async function PackThreadPage({
  params,
  searchParams,
}: {
  params: { packId: string };
  searchParams: { c?: string };
}) {
  const pack = await loadPack(params.packId);
  if (!pack) notFound();

  const label = pack.title ?? pack.name;
  const focusCommentId = typeof searchParams?.c === "string" && searchParams.c ? searchParams.c : null;
  const backTo = `/play/pack/${pack.id}`;

  return (
    <main className="min-h-dvh bg-bg pt-safe">
      <div className="max-w-lg mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <BackPill fallback="/play" label="Back" tone="play" />
        </div>

        <h1 className="font-display text-2xl text-white leading-tight mb-1">{label}</h1>
        {pack.question_count != null && (
          <p className="font-body text-xs mb-6" style={{ color: "#586058" }}>
            {pack.question_count} question{pack.question_count === 1 ? "" : "s"}
          </p>
        )}

        {/* Solo play, not multiplayer matchmaking (founder call): someone who
            arrives here from a notification or the results screen wants to play
            the quiz, not be put in a queue for an opponent. `?pid=` is the
            reliable resolver — slug-only resolution scans published packs and is
            order-unstable (see challenges/[slug]). */}
        <Button variant="primary" tone="teal" size="md" fullWidth href={`/challenges/${slugify(pack.name)}?pid=${pack.id}`}>
          PLAY THIS QUIZ →
        </Button>

        <div className="mt-6">
          <DiscussionThread
            subjectType="pack"
            subjectId={pack.id}
            title="Talk about this quiz"
            signInNext={backTo}
            focusCommentId={focusCommentId}
          />
        </div>
      </div>
    </main>
  );
}
