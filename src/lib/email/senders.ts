import { FROM, REPLY_TO, getResend } from "./client";
import { buildFooterUrls, renderEmail } from "./render";

/** Centralised wrapper — never throws, always logs. */
async function sendOrLog(
  label: string,
  args: Parameters<ReturnType<typeof getResend>["emails"]["send"]>[0],
) {
  try {
    await getResend().emails.send(args);
  } catch (err) {
    console.error(`[email] ${label} failed:`, err);
  }
}

/**
 * 01 · Welcome — fire on first OAuth sign-in via auth callback.
 * Neutral 4-path design: doesn't push one mode over another.
 */
export async function sendWelcomeEmail(args: { userId: string; email: string }) {
  const html = await renderEmail("01-welcome", {
    ...buildFooterUrls(args.userId, "all"),
  });
  await sendOrLog("sendWelcomeEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: "You're in. Pick your move.",
    html,
    headers: { "X-Entity-Ref-ID": `welcome-${args.userId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "01-welcome" },
    ],
  });
}

/**
 * 02 · First Challenge completed.
 * Caller is responsible for confirming this is the user's actual first attempt.
 */
export async function sendFirstQuizEmail(args: {
  userId: string;
  email: string;
  club: string;
  score: number;
  accuracy: number;
  streak: number;
}) {
  const html = await renderEmail("02-first-quiz", {
    club: args.club.toUpperCase(),
    score: args.score.toLocaleString(),
    p4p: String(args.accuracy),
    streak: String(args.streak),
    ...buildFooterUrls(args.userId, "all"),
  });
  await sendOrLog("sendFirstQuizEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: `${args.score.toLocaleString()} pts. ${args.accuracy}% accuracy. Now beat your mates.`,
    html,
    headers: { "X-Entity-Ref-ID": `first-quiz-${args.userId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "02-first-quiz" },
    ],
  });
}

/**
 * 03 · First quiz league created — fires to the creator after their first `leagues` insert.
 * (38-0 leagues live in `draft_leagues` and use email 14 instead.)
 */
export async function sendFirstLeagueCreatedEmail(args: {
  userId: string;
  email: string;
  leagueId: string;
  leagueName: string;
  leagueCode: string;
}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  const leagueUrl = `${base}/league/${args.leagueId}`;
  const inviteUrl = `${base}/league/join/${args.leagueCode}`;
  const waText = encodeURIComponent(
    `Join my YourScore league: ${args.leagueName}\nCode: ${args.leagueCode}\n${inviteUrl}`,
  );
  const html = await renderEmail("03-first-league-created", {
    league_name: args.leagueName,
    league_code: args.leagueCode,
    league_url: leagueUrl,
    whatsapp_share_url: `https://wa.me/?text=${waText}`,
    ...buildFooterUrls(args.userId, args.leagueId),
  });
  await sendOrLog("sendFirstLeagueCreatedEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: `${args.leagueName} is live. Now invite your mates.`,
    html,
    headers: { "X-Entity-Ref-ID": `first-league-${args.leagueId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "03-first-league-created" },
    ],
  });
}

/**
 * 04 · League invite received — fires when a user joins a (quiz) league.
 */
export async function sendLeagueInviteEmail(args: {
  userId: string;
  email: string;
  inviterName: string;
  leagueId: string;
  leagueName: string;
  memberCount: number;
  top3: Array<{ name: string; score: number }>;
}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  const leagueUrl = `${base}/league/${args.leagueId}`;
  const [t1, t2, t3] = [args.top3[0], args.top3[1], args.top3[2]];
  const html = await renderEmail("04-league-invite", {
    inviter_name: args.inviterName,
    league_name: args.leagueName,
    member_count: String(args.memberCount),
    league_url: leagueUrl,
    top1_name: t1?.name ?? "—",
    top1_score: t1 ? t1.score.toLocaleString() : "—",
    top2_name: t2?.name ?? "—",
    top2_score: t2 ? t2.score.toLocaleString() : "—",
    top3_name: t3?.name ?? "—",
    top3_score: t3 ? t3.score.toLocaleString() : "—",
    ...buildFooterUrls(args.userId, args.leagueId),
  });
  await sendOrLog("sendLeagueInviteEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: `${args.inviterName} added you to ${args.leagueName}.`,
    html,
    headers: { "X-Entity-Ref-ID": `invite-${args.userId}-${args.leagueId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "04-league-invite" },
    ],
  });
}

/**
 * 09 · First member joins — fires to the league CREATOR
 * when the first other user joins their league.
 */
export async function sendFirstMemberJoinsEmail(args: {
  creatorUserId: string;
  creatorEmail: string;
  joinerName: string;
  leagueId: string;
  leagueName: string;
  leagueCode: string;
}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  const leagueUrl = `${base}/league/${args.leagueId}`;
  const inviteUrl = `${base}/league/join/${args.leagueCode}`;
  const waText = encodeURIComponent(
    `Join my YourScore league: ${args.leagueName}\nCode: ${args.leagueCode}\n${inviteUrl}`,
  );
  const html = await renderEmail("09-first-member-joins", {
    joiner_name: args.joinerName,
    league_name: args.leagueName,
    league_code: args.leagueCode,
    league_url: leagueUrl,
    whatsapp_share_url: `https://wa.me/?text=${waText}`,
    ...buildFooterUrls(args.creatorUserId, args.leagueId),
  });
  await sendOrLog("sendFirstMemberJoinsEmail", {
    from: FROM,
    to: args.creatorEmail,
    replyTo: REPLY_TO,
    subject: `${args.joinerName} just joined ${args.leagueName}.`,
    html,
    headers: { "X-Entity-Ref-ID": `first-member-${args.leagueId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "09-first-member-joins" },
    ],
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 38-0 senders. Wired server-side from the /api/draft/* route handlers.
 * Callers are responsible for the "is this actually the first?" check before
 * invoking — see each route handler for the heuristic.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 11 · First Draft XI team built.
 * Caller already confirmed: draft_teams row exists for user and created_at ≈ updated_at.
 */
export async function sendFirst38TeamEmail(args: {
  userId: string;
  email: string;
  teamName: string;
  formation: string;
  strength: number;
  projectedPosition: string;
  projectedPoints: number;
}) {
  const html = await renderEmail("11-first-draft-xi", {
    team_name: args.teamName,
    formation: args.formation,
    strength: String(args.strength),
    position: args.projectedPosition,
    projected_points: String(args.projectedPoints),
    ...buildFooterUrls(args.userId, "all"),
  });
  await sendOrLog("sendFirst38TeamEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: "Your team is built. Now put it on the pitch.",
    html,
    headers: { "X-Entity-Ref-ID": `first-38-team-${args.userId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "11-first-draft-xi" },
    ],
  });
}

/**
 * 12 · First 38-0 match played.
 * Caller already confirmed: this is the user's first row in draft_matches.
 */
export async function sendFirst38GameEmail(args: {
  userId: string;
  email: string;
  teamName: string;
  opponent: string;
  myScore: number;
  oppScore: number;
  strength: number;
  w: number;
  d: number;
  l: number;
}) {
  const resultWord =
    args.myScore > args.oppScore
      ? "FULL TIME · WIN"
      : args.myScore < args.oppScore
        ? "FULL TIME · LOSS"
        : "FULL TIME · DRAW";
  const html = await renderEmail("12-first-38-game", {
    result_word: resultWord,
    my_score: String(args.myScore),
    opp_score: String(args.oppScore),
    opponent: args.opponent,
    team_name: args.teamName,
    strength: String(args.strength),
    w: String(args.w),
    d: String(args.d),
    l: String(args.l),
    ...buildFooterUrls(args.userId, "all"),
  });
  await sendOrLog("sendFirst38GameEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: `${resultWord.replace("FULL TIME · ", "")}. ${args.myScore}-${args.oppScore} vs ${args.opponent}.`,
    html,
    headers: { "X-Entity-Ref-ID": `first-38-game-${args.userId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "12-first-38-game" },
    ],
  });
}

/**
 * 13 · First 38-0 H2H challenge sent.
 * Caller already confirmed: this is the user's first row in draft_challenges as challenger.
 */
export async function sendFirst38H2HEmail(args: {
  userId: string;
  email: string;
  code: string;
  teamName: string;
  strength: number;
}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  const challengeUrl = `${base}/38-0/challenge/${args.code}`;
  const waText = encodeURIComponent(
    `I built an XI on YourScore. Beat me if you can — ${challengeUrl}`,
  );
  const html = await renderEmail("13-first-38-h2h", {
    code: args.code,
    challenge_url: challengeUrl,
    whatsapp_share_url: `https://wa.me/?text=${waText}`,
    team_name: args.teamName,
    strength: String(args.strength),
    ...buildFooterUrls(args.userId, "all"),
  });
  await sendOrLog("sendFirst38H2HEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: "Challenge sent. Now make sure they accept.",
    html,
    headers: { "X-Entity-Ref-ID": `first-38-h2h-${args.userId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "13-first-38-h2h" },
    ],
  });
}

/**
 * 14 · First 38-0 league created.
 * Caller already confirmed: this is the user's first row in draft_leagues as owner.
 */
export async function sendFirst38LeagueEmail(args: {
  userId: string;
  email: string;
  leagueId: string;
  leagueName: string;
  leagueCode: string;
}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
  const leagueUrl = `${base}/38-0/league/${args.leagueId}`;
  const inviteUrl = `${base}/38-0/league/join/${args.leagueCode}`;
  const waText = encodeURIComponent(
    `Join my 38-0 league: ${args.leagueName}\nCode: ${args.leagueCode}\n${inviteUrl}`,
  );
  const html = await renderEmail("14-first-38-league", {
    league_name: args.leagueName,
    league_code: args.leagueCode,
    league_url: leagueUrl,
    whatsapp_share_url: `https://wa.me/?text=${waText}`,
    ...buildFooterUrls(args.userId, args.leagueId),
  });
  await sendOrLog("sendFirst38LeagueEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: `${args.leagueName} is live. Now bring the rivals in.`,
    html,
    headers: { "X-Entity-Ref-ID": `first-38-league-${args.leagueId}` },
    tags: [
      { name: "category", value: "lifecycle" },
      { name: "template", value: "14-first-38-league" },
    ],
  });
}
