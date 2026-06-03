// Supabase Edge Function — send a push notification to all device tokens
// for the players in a given room.
//
// Trigger from /admin/rooms when an admin fires a question.
// Body: { roomId: string; title: string; body: string; url?: string }
//
// Deploy: `supabase functions deploy send-push`
//
// Secrets:
//   APNS_KEY_ID         — 10-char key ID from Apple Developer
//   APNS_TEAM_ID        — Apple Developer team ID
//   APNS_BUNDLE_ID      — app.yourscore.app
//   APNS_PRIVATE_KEY    — contents of AuthKey_XXXXXXXXXX.p8 (full PEM block)
//   APNS_ENV            — "production" | "sandbox" (default production)
//   FCM_PROJECT_ID      — Firebase project ID
//   FCM_CLIENT_EMAIL    — service account client_email
//   FCM_PRIVATE_KEY     — service account private_key (full PEM block)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create as createJwt, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

interface Payload {
  roomId: string;
  title: string;
  body: string;
  url?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Require the service-role key in the Authorization header. Anonymous callers
  // shouldn't be able to fan out pushes or enumerate device tokens via roomId
  // guessing. Only the admin server (Next.js API route) holds this key.
  const authHeader = req.headers.get('authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // Fail CLOSED: if the secret is unset, reject everything (never accept a
  // bare "Bearer " token). Otherwise require an exact match.
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const { roomId, title, body, url } = payload;
  if (typeof roomId !== 'string' || typeof title !== 'string' || typeof body !== 'string') {
    return new Response('Bad Request', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: members } = await supabase
    .from('room_members')
    .select('user_id')
    .eq('room_id', roomId);

  if (!members?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  const userIds = members.map((m) => m.user_id);
  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('token, platform')
    .in('user_id', userIds);

  if (!tokens?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  let sent = 0;
  let failed = 0;
  for (const t of tokens) {
    try {
      if (t.platform === 'ios') await sendAPNs(t.token, title, body, url);
      else if (t.platform === 'android') await sendFCM(t.token, title, body, url);
      sent++;
    } catch (e) {
      failed++;
      console.warn('[send-push] failed', t.platform, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify({ sent, failed }), { status: 200 });
});

// ── APNs (HTTP/2 + ES256 JWT) ─────────────────────────────────────────────────

let cachedApnsJwt: { token: string; expiresAt: number } | null = null;

async function apnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedApnsJwt && cachedApnsJwt.expiresAt > now + 60) return cachedApnsJwt.token;

  const keyId = Deno.env.get('APNS_KEY_ID')!;
  const teamId = Deno.env.get('APNS_TEAM_ID')!;
  const pem = Deno.env.get('APNS_PRIVATE_KEY')!;

  const cryptoKey = await importPkcs8(pem, 'ECDSA', { name: 'ECDSA', namedCurve: 'P-256' });
  // Apple enforces a 60-minute hard cap on APNs JWTs; rotate at 50 min to avoid
  // exp drift. Include exp explicitly so the token isn't silently rejected by
  // newer APNs server versions that require it.
  const token = await createJwt(
    { alg: 'ES256', typ: 'JWT', kid: keyId },
    { iss: teamId, iat: now, exp: now + 55 * 60 },
    cryptoKey,
  );
  cachedApnsJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

async function sendAPNs(token: string, title: string, body: string, url?: string) {
  const bundleId = Deno.env.get('APNS_BUNDLE_ID')!;
  const env = (Deno.env.get('APNS_ENV') ?? 'production').toLowerCase();
  const host = env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

  const jwt = await apnsJwt();
  const payload = {
    aps: { alert: { title, body }, sound: 'default', 'mutable-content': 1 },
    ...(url ? { url } : {}),
  };

  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const reason = await res.text().catch(() => res.statusText);
    throw new Error(`APNs ${res.status}: ${reason}`);
  }
}

// ── FCM HTTP v1 (OAuth2 + service-account JWT) ────────────────────────────────

let cachedFcmToken: { token: string; expiresAt: number } | null = null;

async function fcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedFcmToken && cachedFcmToken.expiresAt > now + 60) return cachedFcmToken.token;

  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL')!;
  const pem = Deno.env.get('FCM_PRIVATE_KEY')!;
  const cryptoKey = await importPkcs8(pem, 'RSASSA-PKCS1-v1_5', { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' });

  const assertion = await createJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: getNumericDate(0),
      exp: getNumericDate(60 * 60),
    },
    cryptoKey,
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`FCM token exchange ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedFcmToken = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

async function sendFCM(token: string, title: string, body: string, url?: string) {
  const projectId = Deno.env.get('FCM_PROJECT_ID')!;
  const accessToken = await fcmAccessToken();

  const message = {
    message: {
      token,
      notification: { title, body },
      data: url ? { url } : {},
      android: { priority: 'HIGH' },
    },
  };

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const reason = await res.text().catch(() => res.statusText);
    throw new Error(`FCM ${res.status}: ${reason}`);
  }
}

// ── PEM → CryptoKey helper ────────────────────────────────────────────────────

async function importPkcs8(
  pem: string,
  type: 'ECDSA' | 'RSASSA-PKCS1-v1_5',
  algorithm: EcKeyImportParams | RsaHashedImportParams,
): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey('pkcs8', der.buffer, algorithm, false, ['sign']);
}
