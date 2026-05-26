import { Capacitor } from '@capacitor/core';
import type { SupabaseClient } from '@supabase/supabase-js';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform();

export const NATIVE_AUTH_SCHEME = 'yourscore';
export const NATIVE_AUTH_CALLBACK = `${NATIVE_AUTH_SCHEME}://auth/callback`;
export const WEB_AUTH_CALLBACK = 'https://yourscore.app/auth/callback';

export function authCallbackUrl(): string {
  return isNative() ? NATIVE_AUTH_CALLBACK : WEB_AUTH_CALLBACK;
}

export async function openOAuthInBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url, presentationStyle: 'popover' });
}

export async function closeOAuthBrowser(): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  try {
    await Browser.close();
  } catch {
    // already closed
  }
}

export async function exchangeCodeFromDeepLink(
  supabase: SupabaseClient,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const errorParam = parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error');
    if (errorParam) return { ok: false, error: errorParam };
    if (!code) return { ok: false, error: 'no code in callback url' };
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
