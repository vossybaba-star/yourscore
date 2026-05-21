export function calculatePoints(
  isCorrect: boolean,
  timeMs: number,
  difficulty: "easy" | "medium" | "hard"
): number {
  if (!isCorrect) return 0;

  const basePoints = { easy: 100, medium: 150, hard: 200 }[difficulty];
  const windowMs = 45000;
  const speedBonus = Math.round(
    50 * Math.max(0, (windowMs - timeMs) / windowMs)
  );

  return basePoints + speedBonus;
}

export function applyStreakMultiplier(
  points: number,
  currentStreak: number
): number {
  if (currentStreak >= 5) return Math.round(points * 2.0);
  if (currentStreak >= 3) return Math.round(points * 1.5);
  return points;
}
