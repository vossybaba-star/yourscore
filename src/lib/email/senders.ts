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
 */
export async function sendWelcomeEmail(args: { userId: string; email: string }) {
  const html = await renderEmail("01-welcome", {
    ...buildFooterUrls(args.userId, "all"),
  });
  await sendOrLog("sendWelcomeEmail", {
    from: FROM,
    to: args.email,
    replyTo: REPLY_TO,
    subject: "You're in. Now let's see what you actually know.",
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
 * 03 · First league created — fires to the creator after their first League insert.
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
 * 04 · League invite received — fires to a user when they join a league.
 * Pass the current top 3 + member count from the server.
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
