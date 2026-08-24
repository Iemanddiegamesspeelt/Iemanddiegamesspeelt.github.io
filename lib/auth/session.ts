export const APP_SESSION_COOKIE = 'macrohub_session';
export const APP_LOGIN_INTENT_COOKIE = 'macrohub_login_intent';

export const APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const APP_LOGIN_INTENT_MAX_AGE_SECONDS = 60 * 10;

const APP_LOGIN_START_PATH = '/auth/session/start';
const APP_LOGIN_COMPLETE_PATH = '/auth/session/complete';
const APP_LOGOUT_PATH = '/auth/session/end';
const PLATFORM_SIGN_IN_PATH = '/signin-with-chatgpt';

export function appSignInPath(returnTo: string): string {
  return `${APP_LOGIN_START_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function appSignOutPath(returnTo = '/'): string {
  return `${APP_LOGOUT_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function platformSignInPath(returnTo: string): string {
  return `${PLATFORM_SIGN_IN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function appLoginCompletePath(returnTo: string, state: string): string {
  const params = new URLSearchParams({
    return_to: safeRelativeReturnPath(returnTo),
    state,
  });
  return `${APP_LOGIN_COMPLETE_PATH}?${params.toString()}`;
}

export function safeRelativeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';

  let url: URL;
  try {
    url = new URL(value, 'https://app.local');
  } catch {
    return '/';
  }

  if (url.origin !== 'https://app.local' || isReservedAuthPath(url.pathname)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return pathname === PLATFORM_SIGN_IN_PATH
    || pathname === '/signout-with-chatgpt'
    || pathname === '/callback'
    || pathname.startsWith('/auth/session/');
}
