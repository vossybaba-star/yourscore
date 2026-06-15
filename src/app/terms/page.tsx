import Link from "next/link";

export const metadata = { title: "Terms of Service — YourScore" };

export default function TermsPage() {
  return (
    <main className="min-h-dvh" style={{ background: "#0a0a0f", color: "#eef2f0" }}>
      <nav className="pt-safe px-6 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl text-white mb-2">Terms of Service</h1>
        <p className="font-body text-sm mb-10" style={{ color: "#8a948f" }}>Last updated: May 2026</p>

        <div className="space-y-8 font-body text-sm leading-relaxed" style={{ color: "#c4ccc6" }}>
          <section>
            <h2 className="font-display text-lg text-white mb-3">1. Acceptance</h2>
            <p>By using YourScore you agree to these terms. If you do not agree, do not use the service.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">2. The Service</h2>
            <p>YourScore is a free live football quiz platform. You can play solo challenges, sign up for upcoming matches, answer live quiz questions during games, compete in head-to-head 1v1 quizzes, and track your scores across persistent leagues with friends. No purchase is required to use the core product.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">3. Accounts</h2>
            <p>You may use YourScore as a guest for most features. Creating an account lets you save scores and appear on leaderboards. You are responsible for keeping your account secure. We reserve the right to suspend accounts that violate these terms.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">4. Conduct</h2>
            <p>You agree not to abuse, exploit, or attempt to manipulate the scoring system, impersonate other users, or use the service for any unlawful purpose.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">5. Intellectual Property</h2>
            <p>All content, design, and code is owned by YourScore. Football data and team imagery is sourced from third-party providers under their respective licences.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">6. Disclaimer</h2>
            <p>The service is provided &quot;as is&quot; without warranty of any kind. We are not liable for any loss arising from use of YourScore.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">7. Changes</h2>
            <p>We may update these terms. Continued use of the service after changes constitutes acceptance of the new terms.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">8. Contact</h2>
            <p>Questions? Email us at <span style={{ color: "#ffb800" }}>hello@yourscore.app</span></p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <Link href="/" className="font-body text-sm" style={{ color: "#8a948f" }}>← Back to YourScore</Link>
        </div>
      </div>
    </main>
  );
}
