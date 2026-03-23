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

function normalizeProvider(value: unknown): string | null {
  const p = String(value ?? '').trim().toLowerCase();
  if (!p) return null;
  if (p.includes('google')) return 'google';
  if (p.includes('kakao')) return 'kakao';
  if (p === 'email') return 'email';
  return p;
}

function pickProviderHint(providers: Set<string>) {
  if (providers.has('google') && providers.has('kakao')) return 'social';
  if (providers.has('google')) return 'google';
  if (providers.has('kakao')) return 'kakao';
  if (providers.has('email')) return 'password';
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
    const username = String(body?.username ?? '').trim();
    if (!username) return json(400, { ok: false, message: 'username이 필요합니다.' });

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: appUser, error: appUserErr } = await admin
      .from('app_users')
      .select('id, username')
      .eq('username', username)
      .maybeSingle();

    if (appUserErr) throw appUserErr;
    if (!appUser?.id) {
      return json(200, { ok: true, data: { providerHint: null, providers: [] } });
    }

    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(appUser.id);
    if (userErr || !userRes?.user) {
      return json(200, { ok: true, data: { providerHint: null, providers: [] } });
    }

    const user = userRes.user;
    const providers = new Set<string>();

    const identities = Array.isArray(user.identities) ? user.identities : [];
    identities.forEach((it: any) => {
      const p = normalizeProvider(it?.provider);
      if (p) providers.add(p);
    });

    const appMetaProviders = Array.isArray((user as any)?.app_metadata?.providers)
      ? (user as any).app_metadata.providers
      : [];
    appMetaProviders.forEach((p: any) => {
      const n = normalizeProvider(p);
      if (n) providers.add(n);
    });

    const userMetaProvider = normalizeProvider((user as any)?.user_metadata?.provider);
    if (userMetaProvider) providers.add(userMetaProvider);

    const hint = pickProviderHint(providers);

    return json(200, {
      ok: true,
      data: {
        providerHint: hint,
        providers: Array.from(providers),
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, message: e?.message || String(e) });
  }
});
