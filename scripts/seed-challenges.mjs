/**
 * Seed challenges + challenge_questions from the .txt quiz files.
 * Run: node scripts/seed-challenges.mjs
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mznvuswzgkaupvaqznkm.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY env var required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Parser ─────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseLetter(answerLine) {
  const m = answerLine.match(/Answer:\s*([A-D])\)/i);
  return m ? m[1].toLowerCase() : null;
}

function parseFile(filePath, defaultLeague = "premier-league") {
  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n");

  const teams = [];
  let currentTeam = null;
  let currentQuestions = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Team header: "Arsenal — End of Season Quiz 2025/26"
    const teamMatch = line.match(/^(.+?)\s+—\s+End of Season Quiz/);
    if (teamMatch) {
      if (currentTeam) {
        teams.push({ team: currentTeam, questions: currentQuestions });
      }
      currentTeam = teamMatch[1].trim();
      currentQuestions = [];
      i++;
      continue;
    }

    // Question header: "Q1. [EASY] [season narrative]"
    const qMatch = line.match(/^Q(\d+)\.\s+\[([^\]]+)\]\s+\[([^\]]+)\]/i);
    if (qMatch && currentTeam) {
      const num = parseInt(qMatch[1]);
      const difficulty = qMatch[2].toLowerCase();
      const category = qMatch[3].toLowerCase().replace(/\s+/g, "_");

      // Next lines: question text, then A), B), C), D), Answer:
      let questionLines = [];
      let optA = "", optB = "", optC = "", optD = "", correctAnswer = "";
      i++;

      // Collect question text (until we hit "A)")
      while (i < lines.length && !lines[i].trim().match(/^A\)/)) {
        const l = lines[i].trim();
        if (l) questionLines.push(l);
        i++;
      }

      // Options
      if (i < lines.length && lines[i].trim().match(/^A\)/)) {
        optA = lines[i].trim().replace(/^A\)\s*/, "");
        i++;
      }
      if (i < lines.length && lines[i].trim().match(/^B\)/)) {
        optB = lines[i].trim().replace(/^B\)\s*/, "");
        i++;
      }
      if (i < lines.length && lines[i].trim().match(/^C\)/)) {
        optC = lines[i].trim().replace(/^C\)\s*/, "");
        i++;
      }
      if (i < lines.length && lines[i].trim().match(/^D\)/)) {
        optD = lines[i].trim().replace(/^D\)\s*/, "");
        i++;
      }
      if (i < lines.length && lines[i].trim().match(/^Answer:/i)) {
        correctAnswer = parseLetter(lines[i].trim());
        i++;
      }

      currentQuestions.push({
        question_number: num,
        difficulty: difficulty === "memorable moments" ? "medium" : difficulty,
        category,
        question_text: questionLines.join(" "),
        option_a: optA,
        option_b: optB,
        option_c: optC,
        option_d: optD,
        correct_answer: correctAnswer,
      });
      continue;
    }

    i++;
  }

  // Push last team
  if (currentTeam) {
    teams.push({ team: currentTeam, questions: currentQuestions });
  }

  return teams.map(({ team, questions }) => ({
    team,
    league: defaultLeague,
    slug: `${slugify(team)}-${defaultLeague === "championship" ? "championship" : "pl"}-2526`,
    title: `${team} 2025/26`,
    questions,
  }));
}

// ── Seeder ─────────────────────────────────────────────────────────────────

async function seed() {
  const allChallenges = [
    ...parseFile("/Users/zchukwumah/Downloads/PL_Quiz_All_Teams_2025_26.txt", "premier-league"),
    ...parseFile("/Users/zchukwumah/Downloads/Southampton_Quiz_2025_26.txt", "championship"),
  ];

  console.log(`Parsed ${allChallenges.length} challenges`);
  allChallenges.forEach(c => console.log(` → ${c.slug} (${c.questions.length} Qs)`));

  for (const challenge of allChallenges) {
    // Upsert challenge row
    const { data: challengeRow, error: cErr } = await supabase
      .from("challenges")
      .upsert(
        {
          slug: challenge.slug,
          title: challenge.title,
          team_name: challenge.team,
          league: challenge.league,
          season: "2025-26",
          question_count: challenge.questions.length,
          is_active: true,
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();

    if (cErr) {
      console.error(`Failed to upsert challenge ${challenge.slug}:`, cErr.message);
      continue;
    }

    // Delete existing questions for this challenge (clean re-seed)
    await supabase.from("challenge_questions").delete().eq("challenge_id", challengeRow.id);

    // Insert questions
    const questionsToInsert = challenge.questions.map((q) => ({
      ...q,
      challenge_id: challengeRow.id,
    }));

    const { error: qErr } = await supabase.from("challenge_questions").insert(questionsToInsert);

    if (qErr) {
      console.error(`Failed to insert questions for ${challenge.slug}:`, qErr.message);
    } else {
      console.log(`✓ ${challenge.slug} — ${questionsToInsert.length} questions`);
    }
  }

  console.log("\nDone.");
}

seed().catch(console.error);
