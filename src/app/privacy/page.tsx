import Link from "next/link";

export const metadata = { title: "Privacy Policy — YourScore" };

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh" style={{ background: "#0a0a0f", color: "#e0e0f0" }}>
      <nav className="pt-safe px-6 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="font-display text-4xl text-white mb-2">Privacy Policy</h1>
        <p className="font-body text-sm mb-10" style={{ color: "#8888aa" }}>Last updated: May 2026</p>

        <div className="space-y-8 font-body text-sm leading-relaxed" style={{ color: "#c0c0d8" }}>
          <section>
            <h2 className="font-display text-lg text-white mb-3">What we collect</h2>
            <p>When you create an account we store your email address and any display name you choose. When you play, we store your scores, answers, and streaks. If you sign in with Google, we receive your name and email from Google.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">How we use it</h2>
            <p>Your data is used solely to run the product: showing your scores, placing you on leaderboards, and letting you rejoin leagues. We do not sell your data to third parties. We do not use it for advertising.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">Storage</h2>
            <p>Data is stored in Supabase (PostgreSQL) hosted in the EU. Authentication is handled by Supabase Auth. We use Vercel to serve the application.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">Guests</h2>
            <p>You can use most of YourScore without an account. No personal data is collected for guest sessions.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">Cookies</h2>
            <p>We use a single session cookie to keep you signed in. No tracking or advertising cookies are used.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">Your rights</h2>
            <p>You can delete your account at any time from Settings. This removes your personal data from our systems. You can also request a copy of your data by emailing us.</p>
          </section>

          <section>
            <h2 className="font-display text-lg text-white mb-3">Contact</h2>
            <p>Questions about your data? Email <span style={{ color: "#ffb800" }}>hello@yourscore.app</span></p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <Link href="/" className="font-body text-sm" style={{ color: "#8888aa" }}>← Back to YourScore</Link>
        </div>
      </div>
    </main>
  );
}
