import { isNative, platform } from './native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afPushOptIn } from './analytics/appsflyerEvents';

export async function registerForPush(supabase: SupabaseClient, userId: string) {
  if (!isNative()) return;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    const requested = await PushNotifications.requestPermissions();
    if (requested.receive !== 'granted') return;
  }

  // Permission is granted here (either already or just now). Log the opt-in once
  // per device for AppsFlyer (retention audience); guarded so the re-register on
  // every launch/resume doesn't re-fire it.
  afPushOptIn();

  // Listeners MUST be attached BEFORE register(). When permission is already
  // granted, iOS returns the APNs token almost immediately, so a listener added
  // *after* register() misses the 'registration' event. removeAllListeners()
  // first so repeated calls (we re-register on every launch/resume) don't stack
  // duplicate handlers.
  //
  // NB: this only works because AppDelegate.swift forwards the APNs callbacks to
  // Capacitor (didRegisterForRemoteNotificationsWithDeviceToken →
  // .capacitorDidRegisterForRemoteNotifications). Without that, none of these
  // listeners ever fire — that was the original root cause of empty device_tokens.
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
