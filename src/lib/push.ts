import { isNative, platform } from './native';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function registerForPush(supabase: SupabaseClient, userId: string) {
  if (!isNative()) return;

  // TEMP instrumentation — records each step to push_debug so we can see exactly
  // where token registration stops on a real device. Remove once diagnosed.
  const dbg = (event: string, detail?: string | null) =>
    supabase.from('push_debug').insert({ user_id: userId, event, detail: detail ?? null }).then(() => {}, () => {});

  const { PushNotifications } = await import('@capacitor/push-notifications');
  await dbg('register_start', platform());

  const perm = await PushNotifications.checkPermissions();
  await dbg('perm_check', perm.receive);
  if (perm.receive !== 'granted') {
    const requested = await PushNotifications.requestPermissions();
    await dbg('perm_request', requested.receive);
    if (requested.receive !== 'granted') { await dbg('perm_denied'); return; }
  }

  // Listeners MUST be attached BEFORE register(). When permission is already
  // granted, iOS returns the APNs token almost immediately, so a listener added
  // *after* register() misses the 'registration' event entirely — which is
  // exactly why device_tokens stayed empty. removeAllListeners() first so
  // repeated calls (we re-register on every launch) don't stack duplicates.
  await PushNotifications.removeAllListeners();

  await PushNotifications.addListener('registration', async (t) => {
    await dbg('registration_event', (t.value || '').slice(-12));
    const { error } = await supabase.from('device_tokens').upsert(
      { user_id: userId, token: t.value, platform: platform() as 'ios' | 'android' },
      { onConflict: 'user_id,token' },
    );
    await dbg(error ? 'upsert_error' : 'upsert_ok', error ? error.message : null);
  });

  await PushNotifications.addListener('registrationError', async (e) => {
    await dbg('registration_error', JSON.stringify(e).slice(0, 300));
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      window.location.href = url;
    }
  });

  await dbg('register_called');
  await PushNotifications.register();
}
