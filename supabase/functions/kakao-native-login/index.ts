// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const passwordPepper = Deno.env.get('KAKAO_AUTH_PEPPER') ?? 'nutrimatch-kakao-default-pepper';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeUsername(seed: string) {
  const cleaned = String(seed || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return cleaned || 'kakao_user';
}

function parseBirthyear(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseAgeFromAgeRange(value: unknown): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  // Kakao format example: "20~29"
  const m = raw.match(/(\d+)\s*~\s*(\d+)/);
  if (!m) return null;
  const a = Number.parseInt(m[1], 10);
  const b = Number.parseInt(m[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a + b) / 2);
}

function parseAgeFromBirthyear(value: unknown): number | null {
  const y = parseBirthyear(value);
  if (!y) return null;
  const nowYear = new Date().getFullYear();
  const age = nowYear - y;
  if (!Number.isFinite(age) || age < 1 || age > 120) return null;
  return age;
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildDeterministicPassword(kakaoId: string) {
  const hash = await sha256Hex(`${kakaoId}:${passwordPepper}`);
  return `Ka!${hash.slice(0, 24)}a1#`;
}

async function fetchKakaoUser(accessToken: string) {
  const res = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    throw new Error(body?.msg || body?.message || '카카오 사용자 정보를 확인할 수 없습니다.');
  }
  return body;
}

async function findAuthUserByEmail(adminClient: any, email: string) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const users = data?.users || [];
    const found = users.find((u: any) => String(u?.email || '').toLowerCase() === email.toLowerCase());
    if (found?.id) return found;

    if (users.length < 200) break;
    page += 1;
  }

  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, message: 'POST only' });

  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return json(500, {
        ok: false,
        message: '서버 설정 오류: SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.',
      });
    }

    const body = await req.json().catch(() => null);
    const accessToken = String(body?.accessToken ?? '').trim();
    if (!accessToken) return json(400, { ok: false, message: 'accessToken이 필요합니다.' });

    const kakaoUser = await fetchKakaoUser(accessToken);
    const kakaoId = String(kakaoUser.id);
    const account = kakaoUser.kakao_account ?? {};
    const profile = account.profile ?? {};

    const emailFromKakao = String(account.email ?? '').trim().toLowerCase();
    const providerFullName = String(profile.nickname ?? '').trim() || null;
    const providerAvatarUrl =
      String(profile.profile_image_url ?? '').trim() ||
      String(profile.thumbnail_image_url ?? '').trim() ||
      null;
    const phoneE164 = String(account.phone_number ?? '').trim() || null;
    const providerAgeRange = String(account.age_range ?? '').trim() || null;
    const providerBirthyear = parseBirthyear(account.birthyear);
    const providerBirthday = String(account.birthday ?? '').trim() || null;
    const providerGenderRaw = String(account.gender ?? '').trim().toLowerCase();
    const providerGender = providerGenderRaw === 'male' || providerGenderRaw === 'female' ? providerGenderRaw : null;
    const inferredAge = parseAgeFromBirthyear(account.birthyear) ?? parseAgeFromAgeRange(account.age_range);
    const email = emailFromKakao || `kakao_${kakaoId}@nutrimatch.social.local`;
    const nickname = String(profile.nickname ?? body?.nickname ?? `kakao_${kakaoId}`).trim();
    const username = normalizeUsername(`kakao_${kakaoId}`);
    const password = await buildDeterministicPassword(kakaoId);

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    let authUserId: string | null = null;
    const existing = await findAuthUserByEmail(admin, email);

    if (existing?.id) {
      authUserId = existing.id;
      const { error: updateErr } = await admin.auth.admin.updateUserById(existing.id, {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          provider: 'kakao',
          kakao_id: kakaoId,
          nickname,
        },
      });
      if (updateErr) throw updateErr;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          provider: 'kakao',
          kakao_id: kakaoId,
          nickname,
        },
      });
      if (createErr) throw createErr;
      authUserId = created?.user?.id ?? null;
    }

    if (!authUserId) {
      return json(500, { ok: false, message: 'Auth 사용자 생성/조회에 실패했습니다.' });
    }

    const { data: existingAppUser } = await admin
      .from('app_users')
      .select('id, age, gender')
      .eq('id', authUserId)
      .maybeSingle();

    const nextAge = (() => {
      const existing = Number((existingAppUser as any)?.age);
      if (Number.isFinite(existing) && existing > 0) return existing;
      return inferredAge;
    })();

    const nextGender = (() => {
      const existing = String((existingAppUser as any)?.gender ?? '').trim().toLowerCase();
      if (existing === 'male' || existing === 'female' || existing === 'other') return existing;
      return providerGender;
    })();

    // Ensure app_users row exists for app profile bootstrapping.
    await admin
      .from('app_users')
      .upsert(
        {
          id: authUserId,
          username,
          nickname: nickname.slice(0, 30) || username,
          device_id: null,
          social_provider: 'kakao',
          social_provider_user_id: kakaoId,
          phone_e164: phoneE164,
          provider_age_range: providerAgeRange,
          provider_birthyear: providerBirthyear,
          provider_birthday: providerBirthday,
          provider_full_name: providerFullName,
          provider_avatar_url: providerAvatarUrl,
          age: nextAge,
          gender: nextGender,
        } as any,
        { onConflict: 'id' }
      );

    return json(200, {
      ok: true,
      data: {
        email,
        password,
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message || String(e) });
  }
});
