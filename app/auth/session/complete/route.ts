import { NextRequest, NextResponse } from 'next/server';
import { getPlatformChatGPTUser } from '../../../chatgpt-auth';
import {
  APP_LOGIN_INTENT_COOKIE,
  APP_SESSION_COOKIE,
  APP_SESSION_MAX_AGE_SECONDS,
  appSignInPath,
  safeRelativeReturnPath,
} from '../../../../lib/auth/session';

export async function GET(request: NextRequest) {
  const returnTo = safeRelativeReturnPath(request.nextUrl.searchParams.get('return_to'));
  const state = request.nextUrl.searchParams.get('state');
  const intent = request.cookies.get(APP_LOGIN_INTENT_COOKIE)?.value;
  const identity = await getPlatformChatGPTUser();

  if (!state || !intent || state !== intent || !identity) {
    const response = NextResponse.redirect(new URL(appSignInPath(returnTo), request.url), 303);
    response.cookies.delete(APP_LOGIN_INTENT_COOKIE);
    return response;
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(APP_SESSION_COOKIE, 'active', {
    httpOnly: true,
    maxAge: APP_SESSION_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  response.cookies.delete(APP_LOGIN_INTENT_COOKIE);
  return response;
}
