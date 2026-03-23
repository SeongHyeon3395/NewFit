import { BASE_URL, ENDPOINTS, buildSupabaseHeaders } from '../config';
import { Platform } from 'react-native';
import { fetchJson, fetchWithTimeout } from './http';
import { supabase } from './supabaseClient';

export type AnalyzeResponse = {
  ok: boolean;
  // Backend returns { ok: true, data: { ... } }
  data?: {
    dish?: string; // Name of the dish
    brand?: string;
    source?: string;
    reference_standard?: string;
    estimated_macros?: any;
    userAnalysis?: any;
    confidence?: number;
    notes?: string;
    geminiUsed?: boolean;
    [key: string]: any;
  };
  message?: string;
  // Fallback for flat structure
  [key: string]: any;
};

export type SignupDeviceRequest = {
  username: string;
  nickname: string;
  password: string;
};

export type SignupDeviceResponse = {
  ok: boolean;
  message?: string;
  data?: {
    userId: string;
  };
};

export type CheckUsernameResponse = {
  ok: boolean;
  message?: string;
  data?: {
    available: boolean;
  };
};

export type HealthChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type HealthChatRequest = {
  message: string;
  history?: HealthChatMessage[];
  userContext?: Record<string, any> | null;
};

export type HealthChatResponse = {
  ok: boolean;
  message?: string;
  data?: {
    reply: string;
    model?: string;
    token?: {
      used?: number;
      remaining?: number;
      limit?: number;
      planId?: string;
    };
  };
  [key: string]: any;
};

async function getSessionAccessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return typeof token === 'string' && token.trim() ? token : undefined;
}

function normalizeUri(uri: string) {
  // On iOS, ImagePicker returns 'file://', Android may return content or file scheme.
  // For fetch multipart with RN, keep URI as-is.
  return uri;
}

async function uploadImage(endpoint: string, fileUri: string, extraFields?: Record<string, string>) {
  if (!BASE_URL) {
    throw new Error(
      '환경변수 BASE_URL이 비어있습니다. .env에 BASE_URL(예: https://<project-ref>.functions.supabase.co)과 SUPABASE_ANON_KEY를 설정하고 Metro를 재시작하세요.'
    );
  }
  const form = new FormData();
  const filename = fileUri.split('/').pop() || `capture_${Date.now()}.jpg`;
  const rnFile = {
    uri: normalizeUri(fileUri),
    type: 'image/jpeg',
    name: filename,
  };
  form.append('file', rnFile);

  if (extraFields) {
    Object.entries(extraFields).forEach(([k, v]) => {
      if (typeof v === 'string') form.append(k, v);
    });
  }

  const res = await fetchWithTimeout(
    `${BASE_URL}${endpoint}`,
    {
      method: 'POST',
      headers: {
        ...buildSupabaseHeaders(),
        // Do NOT set 'Content-Type' manually for RN FormData; boundary is auto-set
      },
      body: form,
    },
    20000
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const baseMessage = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    const detailParts = [
      typeof (json as any)?.code === 'number' ? `code: ${(json as any).code}` : `status: ${res.status}`,
      typeof (json as any)?.model === 'string' ? `vision: ${(json as any).model}` : null,
      typeof (json as any)?.textModel === 'string' ? `text: ${(json as any).textModel}` : null,
      typeof (json as any)?.retryAfterSeconds === 'number' ? `retryAfter: ${(json as any).retryAfterSeconds}s` : null,
    ].filter(Boolean);

    const message = detailParts.length > 0
      ? `${baseMessage}\n(${detailParts.join(', ')})`
      : baseMessage;
    throw new Error(message);
  }
  return json as AnalyzeResponse;
}

export async function analyzeFoodImage(fileUri: string, userContext?: Record<string, any> | null) {
  const extra = userContext ? { userContext: JSON.stringify(userContext) } : undefined;
  return uploadImage(ENDPOINTS.analyzeFoodImage, fileUri, extra);
}

export async function pingHealth(): Promise<AnalyzeResponse> {
  if (!BASE_URL) throw new Error('BASE_URL 비어있음');
  const { res, json } = await fetchJson<AnalyzeResponse>(
    `${BASE_URL}${ENDPOINTS.health}`,
    { method: 'GET' },
    { timeoutMs: 8000, retries: 1 }
  );
  if (!res.ok) throw new Error(`Health 실패 HTTP ${res.status}`);
  return json as AnalyzeResponse;
}

export async function chatHealth(payload: HealthChatRequest): Promise<HealthChatResponse> {
  if (!BASE_URL) {
    throw new Error(
      '환경변수 BASE_URL이 비어있습니다. .env에 BASE_URL(예: https://<project-ref>.functions.supabase.co)과 SUPABASE_ANON_KEY를 설정하고 Metro를 재시작하세요.'
    );
  }

  const accessToken = await getSessionAccessToken().catch(() => undefined);

  const { res, json } = await fetchJson<HealthChatResponse>(
    `${BASE_URL}${ENDPOINTS.healthChat}`,
    {
      method: 'POST',
      headers: {
        ...buildSupabaseHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000, retries: 1, retryDelayMs: 700 }
  );
  if (!res.ok || !json?.ok) {
    const message = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as HealthChatResponse;
}

export async function signupDevice(payload: SignupDeviceRequest): Promise<SignupDeviceResponse> {
  if (!BASE_URL) {
    throw new Error(
      '환경변수 BASE_URL이 비어있습니다. .env에 BASE_URL(예: https://<project-ref>.functions.supabase.co)과 SUPABASE_ANON_KEY를 설정하고 Metro를 재시작하세요.'
    );
  }

  const { res, json } = await fetchJson<SignupDeviceResponse>(
    `${BASE_URL}${ENDPOINTS.signupDevice}`,
    {
      method: 'POST',
      headers: {
        ...buildSupabaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 12000, retries: 1 }
  );
  if (!res.ok || !json?.ok) {
    const message = (json as any)?.message || (json as any)?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as SignupDeviceResponse;
}

export async function checkUsername(username: string): Promise<CheckUsernameResponse> {
  if (!BASE_URL) {
    throw new Error(
      '환경변수 BASE_URL이 비어있습니다. .env에 BASE_URL(예: https://<project-ref>.functions.supabase.co)과 SUPABASE_ANON_KEY를 설정하고 Metro를 재시작하세요.'
    );
  }

  const { res, json } = await fetchJson<CheckUsernameResponse>(
    `${BASE_URL}${ENDPOINTS.checkUsername}`,
    {
      method: 'POST',
      headers: {
        ...buildSupabaseHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
    },
    { timeoutMs: 12000, retries: 1 }
  );
  if (!res.ok || !json?.ok) {
    const message = (json as any)?.message || (json as any)?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as CheckUsernameResponse;
}
