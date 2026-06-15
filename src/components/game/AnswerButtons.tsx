import { LETTER_COLORS, type Letter } from "@/lib/theme";

const LETTERS: Letter[] = ["A", "B", "C", "D"];

interface AnswerButtonsProps {
  /** Option text keyed by letter, e.g. { A, B, C, D }. */
  options: Record<string, string>;
  /** Correct answer letter. */
  answer: string;
  /** Currently selected letter, or null. */
  selected: Letter | null;
  /** Whether the correct/incorrect state has been revealed. */
  revealed: boolean;
  /** Accent colour for the pre-reveal selected state. */
  accent: string;
  onAnswer: (letter: Letter) => void;
}

/**
 * The four answer buttons used by the self-paced quiz modes (solo challenges and
 * head-to-head). Previously duplicated verbatim in both pages. The live/match
 * modes use QuestionCard (server-graded) instead.
 */
export function AnswerButtons({ options, answer, selected, revealed, accent, onAnswer }: AnswerButtonsProps) {
  return (
    <div className="space-y-3">
      {LETTERS.map((letter) => {
        const optionText = options[letter];
        const isSelected = selected === letter;
        const isCorrectAnswer = revealed && letter === (answer as Letter);
        const isWrong = revealed && isSelected && !isCorrectAnswer;
        const isDimmed = revealed && !isCorrectAnswer && letter !== selected;
        const lColor = LETTER_COLORS[letter];

        let cardBg = "rgba(255,255,255,0.03)";
        let cardBorder = "rgba(255,255,255,0.09)";
        let textColor = "#eef2f0";
        let chipBg = `${lColor}18`;
        let chipColor = lColor;

        if (isCorrectAnswer) {
          cardBg = "rgba(174,234,0,0.1)"; cardBorder = "#aeea00"; textColor = "#aeea00";
          chipBg = "#aeea00"; chipColor = "#0a0a0f";
        } else if (isWrong) {
          cardBg = "rgba(255,71,87,0.08)"; cardBorder = "rgba(255,71,87,0.5)"; textColor = "#ff4757";
          chipBg = "rgba(255,71,87,0.2)"; chipColor = "#ff4757";
        } else if (isDimmed) {
          cardBg = "transparent"; cardBorder = "rgba(255,255,255,0.04)"; textColor = "#3a423d";
          chipBg = "rgba(255,255,255,0.03)"; chipColor = "#3a423d";
        } else if (isSelected && !revealed) {
          cardBg = `${accent}10`; cardBorder = `${accent}50`; textColor = accent;
          chipBg = `${accent}25`; chipColor = accent;
        }

        return (
          <button key={letter} onClick={() => onAnswer(letter)} disabled={!!selected}
            className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.98]"
            style={{ background: cardBg, border: `1.5px solid ${cardBorder}`, color: textColor, minHeight: 58 }}>
            <span className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-sm flex-shrink-0 transition-all"
              style={{ background: chipBg, color: chipColor }}>
              {isCorrectAnswer ? "✓" : isWrong ? "✗" : letter}
            </span>
            <span className="font-body text-sm font-medium leading-snug">{optionText}</span>
          </button>
        );
      })}
    </div>
  );
}
