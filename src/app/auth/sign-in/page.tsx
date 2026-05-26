"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUser } from "@/hooks/useUser";
import { AuthProviders } from "@/components/auth/AuthButton";

export default function SignInPage() {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  return (
    <main className="min-h-dvh bg-bg flex flex-col">
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)",
        backgroundSize: "40px 40px",
      }} />
      <div className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.07) 0%, transparent 60%)" }} />

      <nav className="relative z-10 px-6 py-5">
        <Link href="/" className="font-display text-2xl text-white tracking-wider hover:opacity-80">YOURSCORE</Link>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl text-white mb-2">Sign in or sign up</h1>
            <p className="font-body text-sm text-text-muted">New or returning — one tap gets you in. Free forever.</p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
            <AuthProviders />
          </div>

          <p className="text-center font-body text-xs text-text-muted mt-6">
            By signing in you agree to our{" "}
            <Link href="/terms" className="text-white hover:underline">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-white hover:underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
