import { isNative, platform } from './native';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function registerForPush(supabase: SupabaseClient, userId: string) {
  if (!isNative()) return;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    const requested = await PushNotifications.requestPermissions();
    if (requested.receive !== 'granted') return;
  }

  // Listeners MUST be attached BEFORE register(). When permission is already
  // granted, iOS returns the APNs token almost immediately, so a listener added
  // *after* register() misses the 'registration' event entirely — which is
  // exactly why device_tokens stayed empty. removeAllListeners() first so
  // repeated calls (we re-register on every launch) don't stack duplicates.
  await PushNotifications.removeAllListeners();

  await PushNotifications.addListener('registration', async (t) => {
    const { error } = await supabase.from('device_tokens').upsert(
      { user_id: userId, token: t.value, platform: platform() as 'ios' | 'android' },
      { onConflict: 'user_id,token' },
    );
    if (error) console.warn('[push] token upsert failed', error);
  });

  await PushNotifications.addListener('registrationError', (e) => {
    console.warn('[push] registration error', e);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      window.location.href = url;
    }
  });

  await PushNotifications.register();
}
