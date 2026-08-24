import { NextRequest, NextResponse } from 'next/server';
import {
  APP_LOGIN_INTENT_COOKIE,
  APP_SESSION_COOKIE,
  safeRelativeReturnPath,
} from '../../../../lib/auth/session';

export async function GET(request: NextRequest) {
  const returnTo = safeRelativeReturnPath(request.nextUrl.searchParams.get('return_to'));
  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.delete(APP_SESSION_COOKIE);
  response.cookies.delete(APP_LOGIN_INTENT_COOKIE);
  return response;
}
