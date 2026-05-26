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

  await PushNotifications.register();

  PushNotifications.addListener('registration', async (t) => {
    await supabase.from('device_tokens').upsert(
      { user_id: userId, token: t.value, platform: platform() as 'ios' | 'android' },
      { onConflict: 'user_id,token' },
    );
  });

  PushNotifications.addListener('registrationError', (e) => {
    console.warn('[push] registration error', e);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      window.location.href = url;
    }
  });
}
