// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getBearerToken(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || '';
}

function sanitizeUsername(value: unknown) {
  const raw = String(value ?? '').toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return cleaned || 'user';
}

function makeSuffix() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function pickNicknameFromMetadata(metadata: Record<string, unknown>) {
  return (
    String(metadata.nickname ?? '').trim() ||
    String(metadata.full_name ?? '').trim() ||
    String(metadata.name ?? '').trim() ||
    ''
  );
}

function pickProvider(metadata: Record<string, unknown>) {
  const p = String(metadata.provider ?? '').trim().toLowerCase();
  if (!p) return null;
  if (p === 'google' || p === 'kakao' || p === 'apple') return p;
  return p;
}

function pickProviderUserId(metadata: Record<string, unknown>) {
  return (
    String(metadata.kakao_id ?? '').trim() ||
    String(metadata.sub ?? '').trim() ||
    null
  );
}

function pickProviderProfileFromIdentity(user: any, metadata: Record<string, unknown>) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];

  let provider = pickProvider(metadata);
  let providerUserId = pickProviderUserId(metadata);
  let fullName =
    String(metadata.full_name ?? '').trim() ||
    String(metadata.name ?? '').trim() ||
    String(metadata.nickname ?? '').trim() ||
    '';
  let avatarUrl =
    String(metadata.avatar_url ?? '').trim() ||
    String(metadata.picture ?? '').trim() ||
    '';

  for (const it of identities) {
    const p = String(it?.provider ?? '').trim().toLowerCase();
    const d = (it?.identity_data ?? {}) as Record<string, unknown>;
    if (!provider && p) provider = p;
    if (!providerUserId) {
      providerUserId =
        String(it?.id ?? '').trim() ||
        String(d?.sub ?? '').trim() ||
        String(d?.id ?? '').trim() ||
        null;
    }
    if (!fullName) {
      fullName =
        String(d?.full_name ?? '').trim() ||
        String(d?.name ?? '').trim() ||
        String(d?.nickname ?? '').trim() ||
        '';
    }
    if (!avatarUrl) {
      avatarUrl =
        String(d?.avatar_url ?? '').trim() ||
        String(d?.picture ?? '').trim() ||
        '';
    }
  }

  return {
    provider: provider || null,
    providerUserId: providerUserId || null,
    fullName: fullName || null,
    avatarUrl: avatarUrl || null,
  };
}

async function usernameExists(client: any, username: string) {
  const { data, error } = await client
    .from('app_users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function buildUniqueUsername(client: any, seed: string) {
  const base = sanitizeUsername(seed).slice(0, 24) || 'user';
  if (!(await usernameExists(client, base))) return base;

  for (let i = 0; i < 8; i++) {
    const candidate = `${base.slice(0, 15)}_${makeSuffix()}`;
    if (!(await usernameExists(client, candidate))) return candidate;
  }

  return `user_${makeSuffix()}`;
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

    const token = getBearerToken(req);
    if (!token) return json(401, { ok: false, message: '인증 토큰이 필요합니다.' });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user?.id) {
      return json(401, { ok: false, message: '유효하지 않은 세션입니다. 다시 로그인해주세요.' });
    }

    const user = authData.user;
    const userId = user.id;
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const providerNickname = pickNicknameFromMetadata(metadata);
    const providerProfile = pickProviderProfileFromIdentity(user, metadata);
    const socialProvider = providerProfile.provider;
    const socialProviderUserId = providerProfile.providerUserId;
    const providerFullName = providerProfile.fullName;
    const providerAvatarUrl = providerProfile.avatarUrl;

    const { data: existing, error: existingErr } = await supabase
      .from('app_users')
      .select('id, username, nickname')
      .eq('id', userId)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (existing?.id) {
      const existingNickname = String(existing.nickname ?? '').trim();
      const existingUsername = String(existing.username ?? '').trim();
      const shouldBackfillNickname =
        Boolean(providerNickname) &&
        (existingNickname.length === 0 || existingNickname === existingUsername || existingNickname === 'user');

      let nickname = existingNickname;
      if (shouldBackfillNickname) {
        const nextNickname = providerNickname.slice(0, 30);
        const { data: updated, error: updateErr } = await supabase
          .from('app_users')
          .update({ nickname: nextNickname } as any)
          .eq('id', userId)
          .select('id, username, nickname')
          .single();

        if (!updateErr && updated?.nickname) {
          nickname = String(updated.nickname);
        }
      }

      if (socialProvider && socialProviderUserId) {
        await supabase
          .from('app_users')
          .update({
            social_provider: socialProvider,
            social_provider_user_id: socialProviderUserId,
            provider_full_name: providerFullName,
            provider_avatar_url: providerAvatarUrl,
          } as any)
          .eq('id', userId);
      }

      return json(200, {
        ok: true,
        data: {
          created: false,
          id: existing.id,
          username: existing.username,
          nickname,
        },
      });
    }

    const email = String(user.email ?? '').trim();
    const emailLocal = email.includes('@') ? email.split('@')[0] : '';

    const seedUsername =
      String(metadata.username ?? '').trim() ||
      emailLocal ||
      String(metadata.preferred_username ?? '').trim() ||
      'user';

    const username = await buildUniqueUsername(supabase, seedUsername);
    const nickname = providerNickname || username;

    const { data: inserted, error: insertErr } = await supabase
      .from('app_users')
      .insert({
        id: userId,
        username,
        nickname: nickname.slice(0, 30),
        device_id: null,
        social_provider: socialProvider,
        social_provider_user_id: socialProviderUserId,
        provider_full_name: providerFullName,
        provider_avatar_url: providerAvatarUrl,
      })
      .select('id, username, nickname')
      .single();

    if (insertErr) throw insertErr;

    return json(200, {
      ok: true,
      data: {
        created: true,
        id: inserted.id,
        username: inserted.username,
        nickname: inserted.nickname,
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message || String(e) });
  }
});
