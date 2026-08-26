import { NextRequest, NextResponse } from 'next/server';
import { getPlatformChatGPTUser } from '../../../chatgpt-auth';
import {
  APP_LOGIN_INTENT_COOKIE,
  APP_LOGIN_INTENT_MAX_AGE_SECONDS,
  APP_SESSION_COOKIE,
  APP_SESSION_MAX_AGE_SECONDS,
  appLoginCompletePath,
  platformSignInPath,
  safeRelativeReturnPath,
} from '../../../../lib/auth/session';

export async function GET(request: NextRequest) {
  const returnTo = safeRelativeReturnPath(request.nextUrl.searchParams.get('return_to'));
  const identity = await getPlatformChatGPTUser();

  if (identity) {
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

  const state = crypto.randomUUID();
  const callbackPath = appLoginCompletePath(returnTo, state);
  const response = NextResponse.redirect(new URL(platformSignInPath(callbackPath), request.url), 303);
  response.cookies.set(APP_LOGIN_INTENT_COOKIE, state, {
    httpOnly: true,
    maxAge: APP_LOGIN_INTENT_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
