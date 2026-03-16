import { supabase } from './supabaseClient';
import type { BodyLog, FoodGrade, FoodLog, ManualMealLog, UserProfile } from '../types/user';
import type { MealPlanMode, MealPlanResult } from '../types/mealPlan';

export type NotificationSettingsRemote = {
  enabled: boolean;
  meal_reminder: boolean;
  weekly_summary: boolean;
  tips: boolean;
};

type AppUserRow = {
  id: string;
  username: string;
  nickname: string;
  device_id?: string | null;
  avatar_path?: string | null;
  body_goal: string | null;
  health_diet: string | null;
  lifestyle_diet: string | null;
  allergens: string[];
  onboarding_completed: boolean;
  current_weight: number | null;
  target_weight: number | null;
  height: number | null;
  age: number | string | null;
  gender: string | null;
  target_calories?: number | string | null;
  target_carbs?: number | string | null;
  target_protein?: number | string | null;
  target_fat?: number | string | null;
  plan_id?: string | null;
  chat_tokens_month?: string | null;
  chat_tokens_used?: number | string | null;
  theme_mode?: string | null;
  created_at: string;
  updated_at: string;
};

export type MonthlyChatTokenStatus = {
  month: string;
  plan_id: string;
  used: number;
  limit_value: number;
  remaining: number;
};

type FoodLogRow = {
  id: string;
  user_id: string;
  image_uri: string | null;
  image_path?: string | null;
  analysis: any;
  meal_type: string | null;
  occurred_at: string;
  notes: string | null;
};

type BodyLogRow = {
  id: string;
  user_id: string;
  weight: number | string | null;
  muscle_mass: number | string | null;
  body_fat: number | string | null;
  occurred_at: string;
};

type ManualMealLogRow = {
  id: string;
  user_id: string;
  date: string;
  meal_type: string | null;
  food_name: string | null;
  calories: number | string | null;
  carbs_g: number | string | null;
  protein_g: number | string | null;
  fat_g: number | string | null;
  image_uri: string | null;
  image_path?: string | null;
  occurred_at: string;
};

function parseNumeric(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function mapAppUserRowToProfile(row: AppUserRow, email: string): UserProfile {
  return {
    id: row.id,
    email,
    name: row.nickname || row.username || '사용자',
    username: row.username,
    nickname: row.nickname,

    avatarPath: row.avatar_path ?? undefined,

    bodyGoal: ((row as any).body_goal as any) ?? 'maintenance',
    healthDiet: ((row as any).health_diet as any) ?? 'none_health',
    lifestyleDiet: ((row as any).lifestyle_diet as any) ?? 'none_lifestyle',
    allergens: Array.isArray(row.allergens) ? row.allergens : [],

    currentWeight: parseNumeric(row.current_weight),
    targetWeight: parseNumeric(row.target_weight),
    height: parseNumeric(row.height),
    age: parseNumeric(row.age),
    gender: ((row as any).gender as any) ?? undefined,

    targetCalories: parseNumeric(row.target_calories),
    targetCarbs: parseNumeric(row.target_carbs),
    targetProtein: parseNumeric(row.target_protein),
    targetFat: parseNumeric(row.target_fat),

    plan_id: ((row as any).plan_id as any) ?? 'free',
    chatTokensMonth: typeof (row as any).chat_tokens_month === 'string' ? (row as any).chat_tokens_month : undefined,
    chatTokensUsed: parseNumeric((row as any).chat_tokens_used),
    themeMode:
      (row as any).theme_mode === 'light' || (row as any).theme_mode === 'dark' || (row as any).theme_mode === 'system'
        ? ((row as any).theme_mode as any)
        : 'system',

    onboardingCompleted: Boolean(row.onboarding_completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProfileUpdatesToAppUserUpdates(updates: Partial<UserProfile>) {
  const out: Record<string, unknown> = {};

  if (updates.username !== undefined) out.username = updates.username;
  if (updates.nickname !== undefined) out.nickname = updates.nickname;
  if (updates.avatarPath !== undefined) out.avatar_path = updates.avatarPath;

  if (updates.bodyGoal !== undefined) out.body_goal = updates.bodyGoal;
  if (updates.healthDiet !== undefined) out.health_diet = updates.healthDiet;
  if (updates.lifestyleDiet !== undefined) out.lifestyle_diet = updates.lifestyleDiet;
  if (updates.allergens !== undefined) out.allergens = updates.allergens;
  if (updates.onboardingCompleted !== undefined) out.onboarding_completed = updates.onboardingCompleted;

  if (updates.currentWeight !== undefined) out.current_weight = updates.currentWeight;
  if (updates.targetWeight !== undefined) out.target_weight = updates.targetWeight;
  if (updates.height !== undefined) out.height = updates.height;
  if (updates.age !== undefined) out.age = updates.age;
  if (updates.gender !== undefined) out.gender = updates.gender;

  if (updates.targetCalories !== undefined) out.target_calories = updates.targetCalories;
  if (updates.targetCarbs !== undefined) out.target_carbs = updates.targetCarbs;
  if (updates.targetProtein !== undefined) out.target_protein = updates.targetProtein;
  if (updates.targetFat !== undefined) out.target_fat = updates.targetFat;

  if (updates.plan_id !== undefined) out.plan_id = updates.plan_id;
  if (updates.themeMode !== undefined) out.theme_mode = updates.themeMode;

  return out;
}

function mapFoodLogRow(row: FoodLogRow): FoodLog {
  return {
    id: row.id,
    userId: row.user_id,
    imageUri: row.image_uri || '',
    analysis: row.analysis,
    mealType: (row.meal_type as any) || 'snack',
    timestamp: row.occurred_at,
    notes: row.notes ?? undefined,
  };
}

export async function deleteFoodLogsRemote(ids: string[]) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) throw new Error('로그인이 필요합니다.');

  const uniqueIds = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim())));
  if (uniqueIds.length === 0) return { deletedCount: 0 };

  const client = requireSupabase();

  // 1) 이미지 경로 수집 (Storage 정리용)
  let imagePaths: string[] = [];
  try {
    const { data: rows, error: selectError } = await client
      .from('food_logs')
      .select('id, image_path')
      .eq('user_id', userId)
      .in('id', uniqueIds)
      .limit(1000);

    if (selectError) {
      const code = String((selectError as any)?.code || '');
      const msg = String((selectError as any)?.message || '');
      // Remote schema가 image_path 컬럼이 없을 수 있음: 이 경우 Storage 정리는 건너뛰고 DB 삭제만 진행
      const isMissingColumn = code === '42703' || /image_path/i.test(msg);
      if (!isMissingColumn) throw selectError;
    } else {
      imagePaths = (rows as Array<{ image_path?: string | null }> | null)
        ?.map((r) => r?.image_path)
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0) ?? [];
    }
  } catch (e: any) {
    const code = String(e?.code || '');
    const msg = String(e?.message || '');
    const isMissingColumn = code === '42703' || /image_path/i.test(msg);
    if (!isMissingColumn) throw e;
  }

  // 2) DB 행 삭제
  const { error: deleteError } = await client
    .from('food_logs')
    .delete()
    .eq('user_id', userId)
    .in('id', uniqueIds);

  if (deleteError) throw deleteError;

  // 3) Storage 이미지 삭제 (실패해도 DB 삭제는 이미 반영되므로 치명 에러로 만들진 않음)
  if (imagePaths.length > 0) {
    try {
      await client.storage.from(FOOD_IMAGES_BUCKET).remove(imagePaths);
    } catch {
      // ignore
    }
  }

  return { deletedCount: uniqueIds.length };
}

const FOOD_IMAGES_BUCKET = 'food-images';
const PROFILE_AVATARS_BUCKET = 'profile-avatars';
const attemptedFoodImageRepairIds = new Set<string>();
const attemptedManualMealImageRepairIds = new Set<string>();

function toUploadableUri(uri: string) {
  const u = String(uri || '').trim();
  if (!u) return '';
  if (/^(file|content):\/\//i.test(u)) return u;
  return `file://${u}`;
}

function blobFromUri(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        resolve(xhr.response as unknown as Blob);
      };
      xhr.onerror = () => reject(new Error('Network request failed'));
      xhr.responseType = 'blob';
      xhr.open('GET', uri, true);
      xhr.send(null);
    } catch (e: any) {
      reject(e);
    }
  });
}

function ensurePlainBase64(b64: string) {
  const s = String(b64 || '').trim();
  const idx = s.indexOf('base64,');
  const plain = idx >= 0 ? s.slice(idx + 'base64,'.length) : s;
  return plain.replace(/[\r\n\s]/g, '');
}

function base64ToUint8Array(b64: string): Uint8Array {
  const input = ensurePlainBase64(b64);
  if (!input) return new Uint8Array(0);

  // Support standard and URL-safe base64
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(256);
  lookup.fill(-1);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  lookup['='.charCodeAt(0)] = 0;

  const len = normalized.length;
  if (len % 4 !== 0) {
    throw new Error('base64 문자열 형식이 올바르지 않습니다.');
  }

  let padding = 0;
  if (len >= 2 && normalized[len - 1] === '=') padding++;
  if (len >= 2 && normalized[len - 2] === '=') padding++;

  const outLen = (len / 4) * 3 - padding;
  const out = new Uint8Array(outLen);

  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = lookup[normalized.charCodeAt(i)];
    const c1 = lookup[normalized.charCodeAt(i + 1)];
    const c2 = lookup[normalized.charCodeAt(i + 2)];
    const c3 = lookup[normalized.charCodeAt(i + 3)];
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      throw new Error('base64 문자열에 허용되지 않는 문자가 있습니다.');
    }

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (o < outLen) out[o++] = (triple >> 16) & 0xff;
    if (o < outLen) out[o++] = (triple >> 8) & 0xff;
    if (o < outLen) out[o++] = triple & 0xff;
  }

  return out;
}

async function uploadFoodImage(fileUri: string, userId: string, base64?: string | null) {
  const client = requireSupabase();

  let body: any = null;
  if (typeof base64 === 'string' && base64.trim()) {
    try {
      body = base64ToUint8Array(base64);
    } catch {
      body = null;
    }
  }

  if (!body) {
    const uploadUri = toUploadableUri(fileUri);
    if (!uploadUri) throw new Error('이미지 URI가 비어있습니다.');

    try {
      body = await blobFromUri(uploadUri);
    } catch {
      const resp = await fetch(uploadUri);
      body = await resp.blob();
    }
  }

  const name = `${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`;
  const path = `${userId}/${name}`;

  const { error } = await client.storage.from(FOOD_IMAGES_BUCKET).upload(path, body as any, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function trySignedUrl(path: string) {
  const client = requireSupabase();
  const { data, error } = await client.storage.from(FOOD_IMAGES_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  return data.signedUrl;
}

async function signedUrlFromBucket(bucket: string, path: string, expiresInSeconds = 60 * 60 * 24 * 7) {
  const client = requireSupabase();
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

async function uploadProfileAvatar(fileUri: string, userId: string, mime?: string | null, base64?: string | null) {
  const client = requireSupabase();
  const isPng = typeof mime === 'string' && /png/i.test(mime);
  const ext = isPng ? 'png' : 'jpg';
  const contentType = isPng ? 'image/png' : 'image/jpeg';

  // Prefer base64 to avoid Android local-uri (file://, content://) blob read issues.
  let body: any = null;
  if (typeof base64 === 'string' && base64.trim()) {
    try {
      body = base64ToUint8Array(base64);
    } catch {
      body = null;
    }
  }

  if (!body) {
    const uploadUri = toUploadableUri(fileUri);
    if (!uploadUri) throw new Error('이미지 URI가 비어있습니다.');
    body = await blobFromUri(uploadUri);
  }

  const name = `avatar_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
  const path = `${userId}/${name}`;

  const { error } = await client.storage.from(PROFILE_AVATARS_BUCKET).upload(path, body as any, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function tryRemoveFromBucket(bucket: string, path: string) {
  try {
    const client = requireSupabase();
    await client.storage.from(bucket).remove([path]);
  } catch {
    // ignore
  }
}

function mapBodyLogRow(row: BodyLogRow): BodyLog {
  return {
    id: row.id,
    userId: row.user_id,
    weight: parseNumeric(row.weight) ?? 0,
    muscleMass: parseNumeric(row.muscle_mass),
    bodyFat: parseNumeric(row.body_fat),
    timestamp: row.occurred_at,
  };
}

function mapManualMealLogRow(row: ManualMealLogRow): ManualMealLog {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    mealType: ((row.meal_type as any) || 'breakfast') as ManualMealLog['mealType'],
    foodName: row.food_name ?? undefined,
    calories: parseNumeric(row.calories) ?? 0,
    carbs_g: parseNumeric(row.carbs_g) ?? 0,
    protein_g: parseNumeric(row.protein_g) ?? 0,
    fat_g: parseNumeric(row.fat_g) ?? 0,
    imageUri: row.image_uri ?? undefined,
    timestamp: row.occurred_at,
  };
}

async function prepareManualMealLogImageFields(log: Partial<ManualMealLog>, userId: string) {
  const rawImageUri = typeof log.imageUri === 'string' ? log.imageUri.trim() : '';
  const rawImageBase64 = typeof log.imageBase64 === 'string' ? log.imageBase64.trim() : '';

  if (!rawImageUri) {
    return { image_path: null as string | null, image_uri: null as string | null };
  }

  if (isLocalDeviceUri(rawImageUri)) {
    const uploadedPath = await uploadFoodImage(rawImageUri, userId, rawImageBase64 || null);
    return { image_path: uploadedPath, image_uri: null as string | null };
  }

  const normalizedPath = normalizeStoragePath(rawImageUri);
  if (looksLikeStoragePath(normalizedPath)) {
    return { image_path: normalizedPath, image_uri: null as string | null };
  }

  return { image_path: null as string | null, image_uri: rawImageUri };
}

async function tryRepairManualMealLogImage(row: ManualMealLogRow): Promise<string | null> {
  const rowId = String(row?.id || '').trim();
  const rowUserId = String(row?.user_id || '').trim();
  const localUri = String(row?.image_uri || '').trim();

  if (!rowId || !rowUserId || !isLocalDeviceUri(localUri)) return null;
  if (attemptedManualMealImageRepairIds.has(rowId)) return null;
  attemptedManualMealImageRepairIds.add(rowId);

  let uploadedPath: string | null = null;
  try {
    uploadedPath = await uploadFoodImage(localUri, rowUserId);

    const client = requireSupabase();
    const { error: imagePathError } = await client
      .from('manual_meal_logs')
      .update({ image_path: uploadedPath, image_uri: null } as any)
      .eq('id', rowId)
      .eq('user_id', rowUserId);

    if (imagePathError) {
      const code = String((imagePathError as any)?.code || '');
      const msg = String((imagePathError as any)?.message || '');
      const isMissingImagePath = code === '42703' || code === 'PGRST204' || /image_path/i.test(msg);
      if (!isMissingImagePath) throw imagePathError;

      const { error: imageUriError } = await client
        .from('manual_meal_logs')
        .update({ image_uri: uploadedPath } as any)
        .eq('id', rowId)
        .eq('user_id', rowUserId);

      if (imageUriError) throw imageUriError;
    }

    return await trySignedUrl(uploadedPath);
  } catch {
    if (uploadedPath) {
      await tryRemoveFromBucket(FOOD_IMAGES_BUCKET, uploadedPath);
    }
    return null;
  }
}

function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isLocalDeviceUri(value: unknown): value is string {
  return typeof value === 'string' && /^(file|content):\/\//i.test(value);
}

function normalizeStoragePath(value: unknown): string {
  if (typeof value !== 'string') return '';

  let v = value.trim();
  if (!v) return '';

  try {
    v = decodeURIComponent(v);
  } catch {
    // ignore decode failure
  }

  if (isRemoteHttpUrl(v)) {
    const match = v.match(/https?:\/\/[^/]+\/storage\/v1\/object\/(?:sign|public|authenticated)\/food-images\/([^?#]+)/i);
    if (match?.[1]) {
      v = match[1];
    }
  }

  v = v.replace(/[?#].*$/, '');
  v = v.replace(/^\/+/, '');
  v = v.replace(/^food-images\//i, '');
  v = v.replace(/^storage\/v1\/object\/(?:sign|public|authenticated)\/food-images\//i, '');

  return v.trim();
}

function looksLikeStoragePath(value: unknown): value is string {
  const normalized = normalizeStoragePath(value);
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized) || /^(file|content):\/\//i.test(normalized)) return false;
  return normalized.includes('/') && !normalized.includes(' ');
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('서버 연결 설정이 없어 요청을 처리할 수 없어요. 네트워크와 앱 설정을 확인해주세요.');
  }
  return supabase;
}

function uuidv4(): string {
  try {
    const c = (globalThis as any)?.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }

  // RFC4122-ish fallback (good enough for client-generated ids)
  const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const b = hex.map(n => n.toString(16).padStart(2, '0')).join('');
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}

function extractMissingColumnFromPgrst204(err: any): string | null {
  const msg = String(err?.message || '');
  const details = String(err?.details || '');
  const text = `${msg} ${details}`;

  // Typical PostgREST message:
  // "Could not find the 'image_path' column of 'food_logs' in the schema cache"
  const m1 = text.match(/find the '([^']+)' column/i);
  if (m1?.[1]) return m1[1];

  // Fallback patterns
  const m2 = text.match(/column\s+"([^"]+)"/i);
  if (m2?.[1]) return m2[1];

  return null;
}

async function tryRepairFoodLogImage(row: FoodLogRow): Promise<string | null> {
  const rowId = String(row?.id || '').trim();
  const rowUserId = String(row?.user_id || '').trim();
  const localUri = String(row?.image_uri || '').trim();

  if (!rowId || !rowUserId || !isLocalDeviceUri(localUri)) return null;
  if (attemptedFoodImageRepairIds.has(rowId)) return null;
  attemptedFoodImageRepairIds.add(rowId);

  let uploadedPath: string | null = null;
  try {
    uploadedPath = await uploadFoodImage(localUri, rowUserId);

    const client = requireSupabase();
    let updated = false;

    const { error: imagePathError } = await client
      .from('food_logs')
      .update({ image_path: uploadedPath } as any)
      .eq('id', rowId)
      .eq('user_id', rowUserId);

    if (!imagePathError) {
      updated = true;
    } else {
      const code = String((imagePathError as any)?.code || '');
      const msg = String((imagePathError as any)?.message || '');
      const isMissingImagePath = code === '42703' || code === 'PGRST204' || /image_path/i.test(msg);

      if (!isMissingImagePath) throw imagePathError;

      const { error: imageUriError } = await client
        .from('food_logs')
        .update({ image_uri: uploadedPath } as any)
        .eq('id', rowId)
        .eq('user_id', rowUserId);

      if (imageUriError) throw imageUriError;
      updated = true;
    }

    if (!updated) throw new Error('이미지 복구 업데이트에 실패했습니다.');

    return await trySignedUrl(uploadedPath);
  } catch {
    if (uploadedPath) {
      await tryRemoveFromBucket(FOOD_IMAGES_BUCKET, uploadedPath);
    }
    return null;
  }
}

export async function attachFoodLogImageRemote(params: { logId: string; imageUri: string; imageBase64?: string | null; userId?: string | null }) {
  const rowId = String(params.logId || '').trim();
  const localUri = String(params.imageUri || '').trim();
  const rowUserId = String(params.userId || '').trim() || (await getSessionUserId()) || '';

  if (!rowId) throw new Error('로그 ID가 비어있습니다.');
  if (!rowUserId) throw new Error('로그인이 필요합니다.');
  if (!isLocalDeviceUri(localUri)) throw new Error('로컬 이미지 URI가 아닙니다.');

  const uploadedPath = await uploadFoodImage(localUri, rowUserId, params.imageBase64 ?? null);
  const client = requireSupabase();

  try {
    const { error: imagePathError } = await client
      .from('food_logs')
      .update({ image_path: uploadedPath } as any)
      .eq('id', rowId)
      .eq('user_id', rowUserId);

    if (imagePathError) {
      const code = String((imagePathError as any)?.code || '');
      const msg = String((imagePathError as any)?.message || '');
      const isMissingImagePath = code === '42703' || code === 'PGRST204' || /image_path/i.test(msg);
      if (!isMissingImagePath) throw imagePathError;

      const { error: imageUriError } = await client
        .from('food_logs')
        .update({ image_uri: uploadedPath } as any)
        .eq('id', rowId)
        .eq('user_id', rowUserId);

      if (imageUriError) throw imageUriError;
    }

    return await trySignedUrl(uploadedPath);
  } catch (error) {
    await tryRemoveFromBucket(FOOD_IMAGES_BUCKET, uploadedPath);
    throw error;
  }
}

async function insertFoodLogRowWithFallback(client: ReturnType<typeof requireSupabase>, row: Record<string, any>) {
  const attempted = new Set<string>();
  let current = { ...row };

  for (let i = 0; i < 5; i++) {
    const { error } = await client.from('food_logs').insert(current);
    if (!error) return;

    const code = (error as any)?.code;
    if (code !== 'PGRST204') throw error;

    const missing = extractMissingColumnFromPgrst204(error);
    if (!missing || attempted.has(missing) || !(missing in current)) {
      const hint =
        '서버 DB 스키마(food_logs)가 앱과 달라 저장에 실패했어요.\n' +
        'Supabase에서 마이그레이션을 적용하고(Postgres), PostgREST schema cache를 리로드해 주세요.';
      const enriched = new Error(`${error.message || '저장 실패'}\n\n${hint}`);
      (enriched as any).cause = error;
      throw enriched;
    }

    attempted.add(missing);
    if (missing === 'image_path' && typeof current.image_path === 'string' && current.image_path.trim()) {
      const storagePath = current.image_path.trim();
      if (!current.image_uri) current.image_uri = storagePath;
    }
    delete current[missing];
  }

  throw new Error('저장 실패: 서버 스키마 불일치가 지속됩니다.');
}

export async function deleteMyAccountRemote() {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
  return data as any;
}

export async function resetMyAccountDataRemote() {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('reset-account-data', { method: 'POST' });
  if (error) throw error;
  return data as any;
}

export async function getSessionUserId(): Promise<string | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session?.user?.id ?? null;
}

export async function getSession() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function fetchMyAppUser() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('app_users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw error;
  const email = session?.user?.email || '';
  return mapAppUserRowToProfile(data as AppUserRow, email);
}

export async function updateMyAppUser(updates: Partial<UserProfile>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const mapped = mapProfileUpdatesToAppUserUpdates(updates);
  if (Object.keys(mapped).length === 0) {
    return fetchMyAppUser();
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('app_users')
    .update(mapped as any)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  const session = await getSession();
  return mapAppUserRowToProfile(data as AppUserRow, session?.user?.email || '');
}

type HealthChatMessageRow = {
  id: string;
  user_id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  created_at: string;
};

export async function fetchMyHealthChatMessagesRemote(limit = 200) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('health_chat_messages')
    .select('id,user_id,role,content,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (Array.isArray(data) ? (data as any) : []) as HealthChatMessageRow[];
}

export async function upsertMyHealthChatMessagesRemote(messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt?: string }>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  if (!Array.isArray(messages) || messages.length === 0) return;

  const client = requireSupabase();
  const rows = messages
    .filter(m => m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      id: m.id,
      user_id: userId,
      role: m.role,
      content: String(m.content ?? ''),
      created_at: m.createdAt ?? undefined,
    }));

  if (rows.length === 0) return;

  const { error } = await client
    .from('health_chat_messages')
    .upsert(rows as any, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteMyHealthChatMessagesRemote() {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { error } = await client
    .from('health_chat_messages')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}

export async function getMyAvatarSignedUrl() {
  const profile = await fetchMyAppUser();
  if (!profile.avatarPath) return null;
  return signedUrlFromBucket(PROFILE_AVATARS_BUCKET, profile.avatarPath).catch(() => null);
}

export async function updateMyProfileAvatarRemote(params: {
  localUri: string;
  base64?: string | null;
  mime?: string | null;
  previousAvatarPath?: string | null;
}) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const nextPath = await uploadProfileAvatar(params.localUri, userId, params.mime ?? null, params.base64 ?? null);

  const client = requireSupabase();
  const { data, error } = await client
    .from('app_users')
    .update({ avatar_path: nextPath } as any)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;

  // best-effort: delete previous avatar object if it exists and differs
  if (params.previousAvatarPath && params.previousAvatarPath !== nextPath) {
    await tryRemoveFromBucket(PROFILE_AVATARS_BUCKET, params.previousAvatarPath);
  }

  const session = await getSession();
  const mapped = mapAppUserRowToProfile(data as AppUserRow, session?.user?.email || '');

  // Attach a signed URL for immediate display (optional convenience)
  const signedUrl = mapped.avatarPath
    ? await signedUrlFromBucket(PROFILE_AVATARS_BUCKET, mapped.avatarPath).catch(() => null)
    : null;

  return { profile: mapped, signedUrl };
}

export async function insertFoodLogRemote(log: Omit<FoodLog, 'id'> & { id?: string; imageBase64?: string | null }) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const imagePath = await uploadFoodImage(log.imageUri, userId, log.imageBase64 ?? null);

  const id = (log as any)?.id ? String((log as any).id) : uuidv4();
  const row: Record<string, any> = {
    id,
    user_id: userId,
    analysis: log.analysis,
    meal_type: log.mealType,
    occurred_at: log.timestamp,
  };

  // Optional columns: older DBs might not have these yet.
  if (imagePath) row.image_path = imagePath;
  if (log.notes != null) row.notes = log.notes;

  const client = requireSupabase();
  // PGRST204(스키마 캐시/컬럼 불일치) 발생 시, 문제 컬럼을 제거하고 재시도하여 저장이 막히지 않게 함.
  await insertFoodLogRowWithFallback(client, row);

  const mapped: FoodLog = {
    id,
    userId,
    imageUri: '',
    analysis: log.analysis,
    mealType: log.mealType,
    timestamp: log.timestamp,
    notes: log.notes,
  };

  if (imagePath) {
    try {
      mapped.imageUri = await trySignedUrl(imagePath);
    } catch {
      // ignore
    }
  }
  return mapped;
}

export async function listFoodLogsRemote(limit = 50) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('food_logs')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = data as FoodLogRow[];
  const logs = rows.map(mapFoodLogRow);
  await Promise.all(
    rows.map(async (row, idx) => {
      const imagePath = normalizeStoragePath(row.image_path);
      const imageUri = typeof row.image_uri === 'string' ? row.image_uri.trim() : '';

      if (imagePath) {
        try {
          logs[idx].imageUri = await trySignedUrl(imagePath);
          return;
        } catch {
          // ignore and continue fallback resolution
        }
      }

      if (isRemoteHttpUrl(imageUri)) {
        const normalizedRemotePath = normalizeStoragePath(imageUri);
        if (looksLikeStoragePath(normalizedRemotePath)) {
          try {
            logs[idx].imageUri = await trySignedUrl(normalizedRemotePath);
            return;
          } catch {
            // ignore and fallback to raw URL below
          }
        }

        logs[idx].imageUri = imageUri;
        return;
      }

      if (looksLikeStoragePath(imageUri)) {
        try {
          logs[idx].imageUri = await trySignedUrl(normalizeStoragePath(imageUri));
          return;
        } catch {
          // ignore
        }
      }

      if (isLocalDeviceUri(imageUri)) {
        const repairedUrl = await tryRepairFoodLogImage(row);
        logs[idx].imageUri = repairedUrl || imageUri;
      }
    })
  );
  return logs;
}

type MonthlyGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';

function clampScore100(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function foodGradeToScore100(grade: FoodGrade): number {
  switch (grade) {
    case 'very_good':
      return 90;
    case 'good':
      return 75;
    case 'neutral':
      return 60;
    case 'bad':
      return 40;
    case 'very_bad':
      return 20;
    default:
      return 60;
  }
}

function foodGradeToScore(grade: FoodGrade): number {
  switch (grade) {
    case 'very_good':
      return 5;
    case 'good':
      return 4;
    case 'neutral':
      return 3;
    case 'bad':
      return 2;
    case 'very_bad':
      return 1;
    default:
      return 3;
  }
}

function scoreToMonthlyLetter(score: number): MonthlyGradeLetter {
  const s = Math.min(5, Math.max(1, Math.round(score)));
  switch (s) {
    case 5:
      return 'A';
    case 4:
      return 'B';
    case 3:
      return 'C';
    case 2:
      return 'D';
    default:
      return 'F';
  }
}

/**
 * 이번 달 food_logs의 userAnalysis.grade를 A~F로 평균 계산합니다.
 * 스캔 기록이 없으면 null을 반환합니다.
 */
export async function getMonthlyAverageGradeLetterRemote(pMonth?: Date) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const base = pMonth instanceof Date ? pMonth : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0);

  const client = requireSupabase();
  const { data, error } = await client
    .from('food_logs')
    .select('analysis, occurred_at')
    .eq('user_id', userId)
    .gte('occurred_at', start.toISOString())
    .lt('occurred_at', end.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  const rows = (data as Array<{ analysis: any }> | null) ?? [];
  if (rows.length === 0) return null;

  const scores = rows
    .map(r => r?.analysis?.userAnalysis?.grade as FoodGrade | undefined)
    .filter((g): g is FoodGrade => typeof g === 'string')
    .map(foodGradeToScore);

  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return scoreToMonthlyLetter(avg);
}

/**
 * 이번 달 food_logs의 userAnalysis.score100(0~100)을 평균 계산합니다.
 * 과거 기록에 score100이 없으면 grade(very_good~very_bad)로 근사치를 사용합니다.
 * 스캔 기록이 없으면 null을 반환합니다.
 */
export async function getMonthlyAverageDietScoreRemote(pMonth?: Date) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const base = pMonth instanceof Date ? pMonth : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0);

  const client = requireSupabase();
  const { data, error } = await client
    .from('food_logs')
    .select('analysis, occurred_at')
    .eq('user_id', userId)
    .gte('occurred_at', start.toISOString())
    .lt('occurred_at', end.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  const rows = (data as Array<{ analysis: any }> | null) ?? [];
  if (rows.length === 0) return null;

  const scores = rows
    .map(r => {
      const ua: any = r?.analysis?.userAnalysis;
      if (!ua) return null;
      const raw = ua?.score100;
      const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isFinite(numeric)) return clampScore100(numeric);
      const grade = ua?.grade as FoodGrade | undefined;
      if (typeof grade === 'string') return foodGradeToScore100(grade);
      return null;
    })
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));

  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return clampScore100(avg);
}

export async function insertBodyLogRemote(log: Omit<BodyLog, 'id'>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const row = {
    user_id: userId,
    weight: log.weight,
    muscle_mass: log.muscleMass ?? null,
    body_fat: log.bodyFat ?? null,
    occurred_at: log.timestamp,
  };

  const client = requireSupabase();
  const { data, error } = await client.from('body_logs').insert(row).select('*').single();
  if (error) throw error;
  return mapBodyLogRow(data as BodyLogRow);
}

export async function updateBodyLogRemote(id: string, updates: Partial<Omit<BodyLog, 'id' | 'userId'>>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const row: Record<string, any> = {};
  if (updates.weight !== undefined) row.weight = updates.weight;
  if (updates.muscleMass !== undefined) row.muscle_mass = updates.muscleMass ?? null;
  if (updates.bodyFat !== undefined) row.body_fat = updates.bodyFat ?? null;
  if (updates.timestamp !== undefined) row.occurred_at = updates.timestamp;

  const client = requireSupabase();
  const { data, error } = await client
    .from('body_logs')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return mapBodyLogRow(data as BodyLogRow);
}

export async function listBodyLogsRemote(limit = 50) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('body_logs')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data as BodyLogRow[]).map(mapBodyLogRow);
}

export async function listManualMealLogsRemote(limit = 500) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('manual_meal_logs')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = ((data as ManualMealLogRow[]) || []);
  const logs = rows.map(mapManualMealLogRow);

  await Promise.all(
    rows.map(async (row, idx) => {
      const imagePath = normalizeStoragePath(row.image_path);
      const imageUri = typeof row.image_uri === 'string' ? row.image_uri.trim() : '';

      if (imagePath) {
        try {
          logs[idx].imageUri = await trySignedUrl(imagePath);
          return;
        } catch {
          // ignore
        }
      }

      if (isRemoteHttpUrl(imageUri)) {
        logs[idx].imageUri = imageUri;
        return;
      }

      if (looksLikeStoragePath(imageUri)) {
        try {
          logs[idx].imageUri = await trySignedUrl(normalizeStoragePath(imageUri));
          return;
        } catch {
          // ignore
        }
      }

      if (imageUri) {
        if (isLocalDeviceUri(imageUri)) {
          const repairedUrl = await tryRepairManualMealLogImage(row);
          logs[idx].imageUri = repairedUrl || imageUri;
          return;
        }

        logs[idx].imageUri = imageUri;
      }
    })
  );

  return logs;
}

export async function upsertManualMealLogsRemote(logs: ManualMealLog[]) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  if (!Array.isArray(logs) || logs.length === 0) return;

  const rows = await Promise.all(
    logs.map(async (log) => {
      const imageFields = await prepareManualMealLogImageFields(log, userId);
      return {
        id: String(log.id),
        user_id: userId,
        date: String(log.date),
        meal_type: log.mealType,
        food_name: log.foodName ?? null,
        calories: Number(log.calories) || 0,
        carbs_g: Number(log.carbs_g) || 0,
        protein_g: Number(log.protein_g) || 0,
        fat_g: Number(log.fat_g) || 0,
        image_uri: imageFields.image_uri,
        image_path: imageFields.image_path,
        occurred_at: log.timestamp,
      };
    })
  );

  const client = requireSupabase();
  const { error } = await client.from('manual_meal_logs').upsert(rows as any, { onConflict: 'id' });
  if (error) throw error;
}

export async function insertManualMealLogRemote(log: ManualMealLog) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const imageFields = await prepareManualMealLogImageFields(log, userId);
  const row = {
    id: String(log.id),
    user_id: userId,
    date: log.date,
    meal_type: log.mealType,
    food_name: log.foodName ?? null,
    calories: Number(log.calories) || 0,
    carbs_g: Number(log.carbs_g) || 0,
    protein_g: Number(log.protein_g) || 0,
    fat_g: Number(log.fat_g) || 0,
    image_uri: imageFields.image_uri,
    image_path: imageFields.image_path,
    occurred_at: log.timestamp,
  };

  const client = requireSupabase();
  const { data, error } = await client.from('manual_meal_logs').insert(row).select('*').single();
  if (error) throw error;
  const mapped = mapManualMealLogRow(data as ManualMealLogRow);
  if (imageFields.image_path) {
    mapped.imageUri = await trySignedUrl(imageFields.image_path).catch(() => mapped.imageUri);
  }
  return mapped;
}

export async function updateManualMealLogRemote(id: string, updates: Partial<ManualMealLog>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const row: Record<string, any> = {};
  if (updates.date !== undefined) row.date = updates.date;
  if (updates.mealType !== undefined) row.meal_type = updates.mealType;
  if (updates.foodName !== undefined) row.food_name = updates.foodName ?? null;
  if (updates.calories !== undefined) row.calories = Number(updates.calories) || 0;
  if (updates.carbs_g !== undefined) row.carbs_g = Number(updates.carbs_g) || 0;
  if (updates.protein_g !== undefined) row.protein_g = Number(updates.protein_g) || 0;
  if (updates.fat_g !== undefined) row.fat_g = Number(updates.fat_g) || 0;
  if (updates.imageUri !== undefined || updates.imageBase64 !== undefined) {
    const imageFields = await prepareManualMealLogImageFields(updates, userId);
    row.image_uri = imageFields.image_uri;
    row.image_path = imageFields.image_path;
  }
  if (updates.timestamp !== undefined) row.occurred_at = updates.timestamp;

  const client = requireSupabase();
  const { data, error } = await client
    .from('manual_meal_logs')
    .update(row)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  const mapped = mapManualMealLogRow(data as ManualMealLogRow);
  const imagePath = normalizeStoragePath((data as ManualMealLogRow)?.image_path);
  if (imagePath) {
    mapped.imageUri = await trySignedUrl(imagePath).catch(() => mapped.imageUri);
  }
  return mapped;
}

export async function deleteManualMealLogRemote(id: string) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { error } = await client
    .from('manual_meal_logs')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function fetchMyNotificationSettingsRemote() {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('notification_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data as any;
}

export async function upsertMyNotificationSettingsRemote(settings: Partial<NotificationSettingsRemote>) {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const client = requireSupabase();
  const { data, error } = await client
    .from('notification_settings')
    .upsert({ user_id: userId, ...settings } as any, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data as any;
}

export async function getMonthlyScanCountRemote(pMonth?: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_monthly_scan_count_consumed', pMonth ? { p_month: pMonth } : {});
  if (error) throw error;
  return (data ?? 0) as number;
}

export async function consumeMonthlyScanRemote(limit: number) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const client = requireSupabase();
  const { data, error } = await client.rpc('consume_monthly_scan', { p_limit: limit });
  if (error) throw error;
  return (data ?? null) as number | null;
}

export async function refundLastScanRemote() {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return false;

  const client = requireSupabase();
  const { data, error } = await client.rpc('refund_last_scan', { p_source: 'food_analyze' });
  if (error) throw error;
  return (data ?? false) as boolean;
}

export async function getMonthlyMealPlanCountRemote(pMonth?: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_monthly_meal_plan_count_consumed', pMonth ? { p_month: pMonth } : {});
  if (error) throw error;
  return (data ?? 0) as number;
}

export async function consumeMonthlyMealPlanRemote(limit: number) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const client = requireSupabase();
  const { data, error } = await client.rpc('consume_monthly_meal_plan', { p_limit: limit });
  if (error) throw error;
  return (data ?? null) as number | null;
}

export async function getMonthlyChatTokenStatusRemote(pMonth?: string) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const client = requireSupabase();
  const { data, error } = await client.rpc('get_monthly_chat_token_status', {
    p_month: pMonth ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    month: String((row as any).month || ''),
    plan_id: String((row as any).plan_id || 'free'),
    used: Number((row as any).used || 0),
    limit_value: Number((row as any).limit_value || 0),
    remaining: Number((row as any).remaining || 0),
  } as MonthlyChatTokenStatus;
}

type MealPlanLogRow = {
  id: number;
  user_id: string;
  mode: string;
  pantry_items: string[] | null;
  preview_title?: string | null;
  preview_kcal?: number | string | null;
  meal_names?: string[] | null;
  result: any;
  occurred_at: string;
};

export type MealPlanLog = {
  id: number;
  userId: string;
  mode: MealPlanMode;
  pantryItems: string[];
  result?: MealPlanResult;
  previewTitle?: string;
  previewKcal?: number;
  mealNames?: string[];
  occurredAt: string;
};

function mapMealPlanLogRow(row: MealPlanLogRow): MealPlanLog {
  return {
    id: row.id,
    userId: row.user_id,
    mode: String(row.mode) === 'pantry' ? 'pantry' : 'general',
    pantryItems: Array.isArray(row.pantry_items) ? row.pantry_items : [],
    result: row.result ? (row.result as MealPlanResult) : undefined,
    previewTitle: typeof row.preview_title === 'string' ? row.preview_title : undefined,
    previewKcal: (() => {
      const v: any = (row as any).preview_kcal;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    })(),
    mealNames: Array.isArray((row as any).meal_names)
      ? ((row as any).meal_names as any[]).map((x) => String(x ?? '').trim()).filter(Boolean)
      : undefined,
    occurredAt: row.occurred_at,
  };
}

function extractMealNamesFromResult(result: MealPlanResult | any): string[] {
  const plan: any[] = Array.isArray(result?.plan) ? result.plan : [];
  const names = new Set<string>();
  for (const day of plan) {
    const meals = day?.meals;
    const candidates = [meals?.breakfast?.name, meals?.lunch?.name, meals?.dinner?.name];
    for (const c of candidates) {
      const s = String(c ?? '').trim();
      if (s) names.add(s);
    }
  }
  return Array.from(names);
}

export async function listMonthlyUsedMealNamesRemote(opts?: { baseDate?: Date }): Promise<string[]> {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return [];

  const base = opts?.baseDate instanceof Date ? opts.baseDate : new Date();
  // Use UTC boundaries to avoid device timezone edge-cases.
  const monthStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1, 0, 0, 0));
  const nextMonthStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 0, 0, 0));

  const client = requireSupabase();
  const { data, error } = await client
    .from('meal_plan_logs')
    .select('meal_names, occurred_at')
    .eq('user_id', userId)
    .gte('occurred_at', monthStart.toISOString())
    .lt('occurred_at', nextMonthStart.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  const used = new Set<string>();
  for (const row of Array.isArray(data) ? (data as any[]) : []) {
    const arr = Array.isArray(row?.meal_names) ? row.meal_names : [];
    for (const v of arr) {
      const s = String(v ?? '').trim();
      if (s) used.add(s);
    }
  }
  return Array.from(used);
}

export async function listMealPlanLogsRemote(limit = 20): Promise<MealPlanLog[]> {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return [];

  const client = requireSupabase();
  const { data, error } = await client
    .from('meal_plan_logs')
    .select('id,user_id,mode,pantry_items,occurred_at,preview_title,preview_kcal')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(Math.max(1, Math.min(50, Math.floor(limit))));
  if (error) throw error;
  const rows = Array.isArray(data) ? (data as any as MealPlanLogRow[]) : [];
  return rows.map(mapMealPlanLogRow);
}

export async function getMealPlanLogRemote(id: number): Promise<MealPlanLog | null> {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const client = requireSupabase();
  const logId = Number(id);
  if (!Number.isFinite(logId)) return null;

  const { data, error } = await client
    .from('meal_plan_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('id', logId)
    .single();
  if (error) throw error;
  if (!data) return null;
  return mapMealPlanLogRow(data as any);
}

export async function insertMealPlanLogRemote(params: {
  mode: MealPlanMode;
  pantryItems?: string[];
  result: MealPlanResult;
}): Promise<MealPlanLog | null> {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return null;

  const client = requireSupabase();
  const day0: any = Array.isArray(params.result?.plan) ? (params.result as any).plan[0] : null;
  const previewTitle = String(day0?.meals?.lunch?.name || day0?.meals?.breakfast?.name || day0?.meals?.dinner?.name || '식단');
  const previewKcal = (() => {
    const n = Number(day0?.totals?.calories);
    return Number.isFinite(n) ? Math.round(n) : 0;
  })();

  const row = {
    user_id: userId,
    mode: params.mode,
    pantry_items: Array.isArray(params.pantryItems) ? params.pantryItems : null,
    result: params.result as any,
    preview_title: previewTitle,
    preview_kcal: previewKcal,
    meal_names: extractMealNamesFromResult(params.result),
  };

  const { data, error } = await client.from('meal_plan_logs').insert(row as any).select('*').single();
  if (error) throw error;
  if (!data) return null;
  return mapMealPlanLogRow(data as any);
}

export async function deleteMealPlanLogRemote(id: number): Promise<boolean> {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return false;

  const client = requireSupabase();
  const logId = Number(id);
  if (!Number.isFinite(logId)) return false;

  const { error } = await client.from('meal_plan_logs').delete().eq('user_id', userId).eq('id', logId);
  if (error) throw error;
  return true;
}

export type MonthlyDietScoreRow = {
  month_start: string;
  avg_score100: number | null;
  logs_count: number;
};

export async function getMonthlyDietScoresTimelineRemote(months = 36) {
  const userId = await getSessionUserId().catch(() => null);
  if (!userId) return [] as MonthlyDietScoreRow[];

  const client = requireSupabase();
  const { data, error } = await client.rpc('get_monthly_diet_scores', { p_months: months });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as MonthlyDietScoreRow[];
}
