import {
  BASE_URL as ENV_BASE_URL,
  SUPABASE_ANON_KEY as ENV_SUPABASE_ANON_KEY,
  SUPABASE_URL as ENV_SUPABASE_URL,
  PRIVACY_POLICY_URL as ENV_PRIVACY_POLICY_URL,
  GOOGLE_WEB_CLIENT_ID as ENV_GOOGLE_WEB_CLIENT_ID,
  KAKAO_NATIVE_APP_KEY as ENV_KAKAO_NATIVE_APP_KEY,
} from '@env';
// Debug 로그: 개발 중 BASE_URL 로딩 문제 추적용
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('[ENV] BASE_URL raw from @env:', ENV_BASE_URL);
}
import { Platform } from 'react-native';

// Backend base URL (injected from .env)
// Examples:
// - Supabase: https://<project-ref>.functions.supabase.co
// - Android emulator local: http://10.0.2.2:8080
// - iOS simulator local: http://localhost:8080
function normalizeBaseUrl(url: string) {
  let u = (url || '').trim().replace(/\/$/, '');
  if (!u) return '';
  // Android 에뮬레이터에서 localhost를 접근할 때 10.0.2.2로 치환
  if (Platform.OS === 'android') {
    u = u.replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://10.0.2.2');
    u = u.replace(/^http:\/\/127\.0\.0\.1(?=[:/]|$)/i, 'http://10.0.2.2');
  }
  return u;
}

// Prefer explicit BASE_URL; else derive from SUPABASE_URL (.supabase.co -> .functions.supabase.co)
let BASE_URL = normalizeBaseUrl(ENV_BASE_URL || '');
if (!BASE_URL && ENV_SUPABASE_URL) {
  const supa = (ENV_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const m = supa.match(/^(https?:)\/\/([^/]+)$/i);
  if (m) {
    const proto = m[1];
    const host = m[2].replace(/\.supabase\.co$/i, '.functions.supabase.co');
    BASE_URL = `${proto}//${host}`;
    if (__DEV__) console.log('[ENV] Derived BASE_URL from SUPABASE_URL:', BASE_URL);
  }
}
if (!BASE_URL) {
  // Fallback: try static JSON file checked into repo (.env.runtime.json)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runtime = require('../.env.runtime.json');
    if (runtime?.BASE_URL) {
      BASE_URL = normalizeBaseUrl(runtime.BASE_URL);
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[ENV] Fallback .env.runtime.json BASE_URL applied:', BASE_URL);
      }
    }
  } catch (_) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[ENV] No .env.runtime.json fallback found');
    }
  }
}
if (__DEV__ && !BASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('[ENV] BASE_URL empty after fallback. Create .env or .env.runtime.json and restart Metro.');
}
export { BASE_URL };

export const ENDPOINTS = {
  // Active Supabase Edge Functions
  analyzeFoodImage: '/analyze-food-image',
  generateMealPlan: '/generate-meal-plan',
  health: '/health',
  healthChat: '/health-chat',
  signupDevice: '/signup-device',
  checkUsername: '/check-username',
} as const;

// Supabase client headers
// Use anon key for public functions or user access token for authenticated calls.
export const SUPABASE_ANON_KEY = ENV_SUPABASE_ANON_KEY || '';

export const GOOGLE_WEB_CLIENT_ID = (
  ENV_GOOGLE_WEB_CLIENT_ID || '1002963880366-s3h0vqf32kt3q1tbrit9thhn4encbecr.apps.googleusercontent.com'
).trim();
export const KAKAO_NATIVE_APP_KEY = (ENV_KAKAO_NATIVE_APP_KEY || '').trim();

// External link (required by store policies). If empty, UI will prompt you to set it.
export const PRIVACY_POLICY_URL = (ENV_PRIVACY_POLICY_URL || '').trim();

// 기본 사용자 월 스캔 기회
export const MONTHLY_SCAN_LIMIT = 5;

// 기본 사용자 월 식단 생성 기회
export const MONTHLY_MEAL_PLAN_LIMIT = 5;

export function buildSupabaseHeaders(token?: string) {
  const bearer = token || SUPABASE_ANON_KEY;
  return {
    Accept: 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${bearer}`,
  } as const;
}
