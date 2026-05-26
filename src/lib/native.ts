import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform();

export const NATIVE_AUTH_SCHEME = 'yourscore';
export const WEB_AUTH_CALLBACK = 'https://yourscore.app/auth/callback';

export function authCallbackUrl(): string {
  return isNative() ? `${NATIVE_AUTH_SCHEME}://auth/callback` : WEB_AUTH_CALLBACK;
}
