/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { REALTIME_ENABLED } from "@/lib/realtime";

interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

interface OtherProfile {
  display_name: string;
  avatar_url: string | null;
}

function Avatar({ name, size = 36, url }: { name: string; size?: number; url?: string | null }) {
  if (url) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1.5px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
  );
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#3a423d", text: "#aeea00" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: c.bg, color: c.text, fontSize: size * 0.4, fontWeight: 700,
      border: "1.5px solid rgba(255,255,255,0.1)",
      fontFamily: "var(--font-body, sans-serif)",
    }}>
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

export default function MessagePage() {
  const { userId: otherUserId } = useParams<{ userId: string }>();
  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [other, setOther] = useState<OtherProfile | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const fetchMessages = useCallback(async (uid: string) => {
    const { data } = await sb
      .from("messages")
      .select("id, sender_id, recipient_id, body, created_at, read_at")
      .or(`and(sender_id.eq.${uid},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(100);
    setMessages((data ?? []) as Message[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherUserId]);

  useEffect(() => {
    // Channel is created inside an async continuation, so hand it back to the
    // effect cleanup via these — a `return` inside .then() goes to the promise,
    // not to React, which leaked one live subscription per page visit.
    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setMyId(uid);
      if (!uid) return;

      // Fetch other user's profile
      const { data: profile } = await supabase
        .from("profiles").select("display_name, avatar_url").eq("id", otherUserId).single();
      setOther(profile as OtherProfile | null);

      await fetchMessages(uid);

      // Subscribe to new messages (own sends also arrive via this channel —
      // sendMessage only inserts, it never appends locally).
      if (!REALTIME_ENABLED || cancelled) return;
      channel = sb
        .channel(`dm:${[uid, otherUserId].sort().join(":")}`)
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "messages",
        }, (payload: any) => {
          const msg = payload.new as Message;
          if (
            (msg.sender_id === uid && msg.recipient_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.recipient_id === uid)
          ) {
            setMessages(prev => [...prev, msg]);
          }
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [otherUserId, fetchMessages, supabase]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !myId || sending) return;
    setSending(true);
    const body = text.trim();
    setText("");
    await sb.from("messages").insert({
      sender_id: myId,
      recipient_id: otherUserId,
      body,
    });
    setSending(false);
  }

  const otherName = other?.display_name ?? "Player";

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  // Group messages by date
  let lastDate = "";

  return (
    <div className="bg-bg flex flex-col" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="flex-shrink-0 pt-safe" style={{
        background: "rgba(10,10,15,0.97)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center gap-3">
          <Link href="/friends" style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            textDecoration: "none",
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="#9aa39d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Avatar name={otherName} size={36} url={other?.avatar_url} />
          <p className="font-body text-base font-bold text-white flex-1 truncate">{otherName}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-lg mx-auto w-full">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="font-body text-sm text-text-muted text-center">
              No messages yet — say hello! 👋
            </p>
          </div>
        )}

        {messages.map((m) => {
          const isMine = m.sender_id === myId;
          const dateStr = formatDate(m.created_at);
          const showDate = dateStr !== lastDate;
          lastDate = dateStr;

          return (
            <div key={m.id}>
              {showDate && (
                <p className="font-body text-xs text-center my-3" style={{ color: "#3a423d" }}>{dateStr}</p>
              )}
              <div className={`flex mb-2 ${isMine ? "justify-end" : "justify-start"}`}>
                {!isMine && (
                  <div className="mr-2 mt-auto">
                    <Avatar name={otherName} size={28} url={other?.avatar_url} />
                  </div>
                )}
                <div style={{
                  maxWidth: "72%",
                  padding: "10px 14px", borderRadius: isMine ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                  background: isMine ? "#00c9ff" : "rgba(255,255,255,0.08)",
                  color: isMine ? "#0a0a0f" : "#ffffff",
                  fontFamily: "var(--font-body, sans-serif)", fontSize: 14, lineHeight: 1.4,
                }}>
                  <p style={{ margin: 0, wordBreak: "break-word" }}>{m.body}</p>
                  <p style={{
                    fontFamily: "var(--font-body, sans-serif)", fontSize: 10,
                    color: isMine ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.35)",
                    textAlign: "right", marginTop: 4, marginBottom: 0,
                  }}>
                    {formatTime(m.created_at)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0" style={{
        background: "rgba(10,10,15,0.97)", borderTop: "1px solid rgba(255,255,255,0.07)",
        padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)",
      }}>
        <form onSubmit={sendMessage} className="flex gap-2 max-w-lg mx-auto">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Message…"
            maxLength={1000}
            className="text-white flex-1"
            style={{
              padding: "11px 14px", borderRadius: 24,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              fontFamily: "var(--font-body, sans-serif)", fontSize: 14, outline: "none",
            }}
          />
          <button type="submit" disabled={!text.trim() || sending}
            style={{
              width: 44, height: 44, borderRadius: "50%", border: "none", flexShrink: 0,
              background: text.trim() ? "#00c9ff" : "rgba(255,255,255,0.08)",
              cursor: text.trim() ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s ease",
            }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M16 9H2M16 9L10 3M16 9L10 15" stroke={text.trim() ? "#0a0a0f" : "#3a423d"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
