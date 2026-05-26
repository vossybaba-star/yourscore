// Supabase Edge Function — send a push notification to all device tokens
// for the players in a given room.
//
// Trigger this from /admin/rooms when an admin fires a question.
// Body: { roomId: string; title: string; body: string; url?: string }
//
// Deploy: `supabase functions deploy send-push`
// Secrets needed:
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY (.p8 contents)
//   FCM_SERVER_KEY (Firebase Cloud Messaging server key)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Payload {
  roomId: string;
  title: string;
  body: string;
  url?: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { roomId, title, body, url }: Payload = await req.json();

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
  for (const t of tokens) {
    try {
      if (t.platform === 'ios') await sendAPNs(t.token, title, body, url);
      else if (t.platform === 'android') await sendFCM(t.token, title, body, url);
      sent++;
    } catch (e) {
      console.warn('[send-push] failed', t.platform, e);
    }
  }

  return new Response(JSON.stringify({ sent }), { status: 200 });
});

// TODO: implement APNs HTTP/2 push via JWT-signed request to api.push.apple.com.
// Use APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY secrets.
async function sendAPNs(_token: string, _title: string, _body: string, _url?: string) {
  throw new Error('APNs sender not implemented');
}

// TODO: implement FCM HTTP v1 push.
// Use FCM_SERVER_KEY secret.
async function sendFCM(_token: string, _title: string, _body: string, _url?: string) {
  throw new Error('FCM sender not implemented');
}
