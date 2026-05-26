import Link from "next/link";

export const metadata = {
  title: "Support — YourScore",
  description: "Get help with YourScore. FAQ + contact.",
};

const SUPPORT_EMAIL = "support@yourscore.app";

const FAQ = [
  {
    q: "How do I join a league?",
    a: "Ask the league creator for the league code (e.g. TL9999), tap Leagues → Join a league, paste the code, you're in.",
  },
  {
    q: "How do points work?",
    a: "Correct answers earn 100–200 points depending on difficulty, plus a speed bonus up to 50 if you answer fast. Get 3 or more correct in a row and a streak multiplier kicks in.",
  },
  {
    q: "Why didn't I get points for an answer?",
    a: "If the match ended before you tapped, or your phone lost connection, the answer may not have registered in time. Points are awarded only for answers submitted while the question is open (45-second window).",
  },
  {
    q: "I signed in with Google but I don't see my old data.",
    a: "Each sign-in method creates a separate account. If you previously used email magic link, sign in that way to access the data. We're working on account linking.",
  },
  {
    q: "How do I delete my account?",
    a: `Email ${SUPPORT_EMAIL} from your registered email address and we'll delete your account and all associated data within 7 days.`,
  },
  {
    q: "Why aren't I getting push notifications?",
    a: "Go to Settings → YourScore → Notifications and enable them. If they're already on, sign out and back in to refresh your device token.",
  },
  {
    q: "I found a bug.",
    a: `Email ${SUPPORT_EMAIL} with what happened, your phone model, and a screenshot if possible. We respond within 24 hours.`,
  },
];

export default function SupportPage() {
  return (
    <main className="min-h-dvh" style={{ background: "#0a0a0f", color: "#e0e0f0" }}>
      <nav className="px-6 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Link href="/" className="font-display text-xl text-white tracking-wider">YOURSCORE</Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl text-white mb-2">Support</h1>
        <p className="font-body text-sm mb-10" style={{ color: "#8888aa" }}>
          We respond to every email within 24 hours.
        </p>

        <div
          className="rounded-2xl p-6 mb-10"
          style={{ background: "#12121e", border: "1px solid rgba(0,255,135,0.2)" }}
        >
          <p className="font-body text-sm mb-1" style={{ color: "#8888aa" }}>Contact</p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-display text-2xl tracking-wide"
            style={{ color: "#00ff87" }}
          >
            {SUPPORT_EMAIL}
          </a>
        </div>

        <h2 className="font-display text-2xl text-white mb-6">Frequently asked</h2>

        <div className="space-y-6 font-body text-sm leading-relaxed" style={{ color: "#c0c0d8" }}>
          {FAQ.map((item) => (
            <section key={item.q}>
              <h3 className="font-display text-lg text-white mb-2">{item.q}</h3>
              <p>{item.a}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <p className="font-body text-xs" style={{ color: "#8888aa" }}>
            See also our{" "}
            <Link href="/privacy" className="text-white hover:underline">Privacy Policy</Link>
            {" "}and{" "}
            <Link href="/terms" className="text-white hover:underline">Terms of Service</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
