// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

function getBearerToken(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || '';
}

function buildSystemPrompt() {
  return [
    '너는 뉴핏 앱의 친절한 AI 어시스턴트야.',
    '목표는 사용자의 일반적인 질문에 자연스럽고 유용하게 답하되, 앱 정책상 금지된 주제는 정중히 거절하는 것.',
    '',
    '대화 원칙:',
    '- 인사, 일상 대화, 간단한 정보 설명, 일반 상식성 질문에는 자연스럽게 답한다.',
    '- 질문이 다소 모호해도 가능한 범위에서 먼저 도와주고, 필요한 경우 짧게 되물어 명확화한다.',
    '- 답변은 짧고 이해하기 쉽게 작성한다.',
    '',
    '금지 주제(반드시 거절):',
    '- 코딩/프로그래밍/개발 디버깅',
    '- 정치/사회 이슈 논평 및 시사 토론',
    '- 유튜브 채널/영상 평가 및 추천',
    '- 특정 인물/집단에 대한 평가, 비방, 평판 판단',
    '- 잔인하거나 폭력적인 내용, 불법 행위 조장, 성적으로 부적절한 내용',
    '- 증오/차별/괴롭힘 등 유해 콘텐츠',
    '- 위 항목은 자세한 설명 없이도 짧고 정중하게 거절한다.',
    '',
    '건강/식단 질문이 오면:',
    '- 기존처럼 실용적인 가이드를 제공한다.',
    '- 의학적 진단/처방은 하지 말고, 위험 신호가 있으면 전문가 상담을 권한다.',
    '',
    '거절 문구 규칙:',
    '- 금지 주제에는 "해당 주제는 도와드릴 수 없어요. 다른 일반 질문이나 건강/식단 질문은 도와드릴게요."와 유사한 짧은 문구를 사용한다.',
    '- 사용자가 쓴 언어를 최대한 따라 답한다. 영어/일본어/중국어 질문이면 해당 언어로 답한다.',
    '- 한국어와 영어가 섞인 질문이면 너무 딱딱하게 한 언어만 고집하지 말고, 사용자가 이해하기 쉬운 자연스러운 언어로 답한다.',
    '- 언어가 불명확하면 기본은 한국어로 답한다.',
    '- 마크다운 문법(**, __, #, `)은 사용하지 않는다.',
  ].join('\n');
}

function detectReplyLanguage(message: string): 'ko' | 'en' | 'ja' | 'zh' {
  const text = String(message || '').trim();
  if (!text) return 'ko';

  const jaMatches = text.match(/[\u3040-\u30ff]/g) || [];
  if (jaMatches.length >= 2) return 'ja';

  const zhHints = /(减肥|增肌|卡路里|热量|蛋白质|脂肪|碳水|饮食|健康|运动|过敏|可以吃|能吃|早餐|午餐|晚餐)/.test(text);
  if (zhHints) return 'zh';

  const latinMatches = text.match(/[A-Za-z]/g) || [];
  const hangulMatches = text.match(/[가-힣]/g) || [];
  if (latinMatches.length >= 4 && latinMatches.length >= hangulMatches.length * 2) return 'en';

  return 'ko';
}

function normalizeText(s: any) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDisallowedTopic(message: string) {
  const t = normalizeText(message);
  if (!t) return false;

  const denyCoding = [
    '코딩', '프로그래밍', '개발', '디버깅', '자바스크립트', '타입스크립트', '리액트', '파이썬', '코드',
    'coding', 'programming', 'debug', 'javascript', 'typescript', 'python', 'react',
  ];
  const denySocialIssue = [
    '정치', '사회 이슈', '시사', '선거', '정당', '이념', 'politics', 'political', 'social issue', 'news debate',
  ];
  const denyYoutube = [
    '유튜브', 'youtube', 'youtuber', '영상 평가', '채널 평가', '영상 추천',
  ];
  const denyPersonEval = [
    '사람 평가', '인물 평가', '평판', '누가 더 낫', '급 나누기', '외모 평가',
    'rate this person', 'judge this person', 'reputation',
  ];
  const denyHarmful = [
    '살인', '자해', '폭탄', '테러', '고문', '잔인', '폭력', '학대',
    'kill', 'murder', 'self-harm', 'suicide', 'bomb', 'terror', 'torture', 'violent',
    '마약 제조', '불법 해킹', '피싱', '사기', 'weapon',
    '혐오', '인종차별', '성차별', '증오', '괴롭힘', 'harass', 'hate', 'racist', 'sexist',
    '포르노', '성착취', '강간', '아동 성', 'porn', 'sexual abuse',
  ];

  const blockedGroups = [denyCoding, denySocialIssue, denyYoutube, denyPersonEval, denyHarmful];
  return blockedGroups.some((arr) => arr.some((k) => t.includes(k)));
}

function offTopicReply(message?: string) {
  const lang = detectReplyLanguage(message || '');
  if (lang === 'en') {
    return 'Sorry, I cannot help with that topic. I can still help with general daily questions or health/diet related questions.';
  }
  if (lang === 'ja') {
    return '申し訳ありませんが、その話題には対応できません。一般的な日常の質問や健康・食事の質問ならお手伝いできます。';
  }
  if (lang === 'zh') {
    return '抱歉，这个话题我无法协助。你可以继续问日常通用问题，或健康/饮食相关问题。';
  }
  return '죄송하지만 해당 주제는 도와드릴 수 없어요. 다른 일반 질문이나 건강/식단 질문은 도와드릴게요.';
}

function toGeminiContents(history: any[], latestUserMessage: string) {
  const contents = [] as any[];

  for (const m of history || []) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m?.text || '').trim();
    if (!text) continue;
    contents.push({ role, content: text });
  }

  const last = String(latestUserMessage || '').trim();
  if (last) contents.push({ role: 'user', content: last });

  return contents;
}

async function callGeminiText({ system, contents, model }: { system: string; contents: any[]; model: string }) {
  const apiKey = Deno.env.get('GEMINI_API_KEY') || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다.');

  const url = `${GEMINI_OPENAI_BASE_URL}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'system', content: system }, ...contents],
    temperature: 0.6,
    top_p: 0.9,
    max_tokens: 600,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Gemini HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text =
    json?.choices?.[0]?.message?.content ||
    '';

  return {
    text: String(text || '').trim(),
    raw: json,
    totalTokens: Number(json?.usage?.total_tokens ?? 0) || 0,
  };
}

function estimateTokensFallback(message: string, reply: string) {
  const totalChars = `${message || ''}\n${reply || ''}`.length;
  return Math.max(1, Math.ceil(totalChars / 2.6));
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'POST only' }, 405);
  }

  try {
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse({ ok: false, message: '서버 설정 오류: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 중 누락된 값이 있습니다.' }, 500);
    }

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ ok: false, message: '로그인이 필요합니다.' }, 401);
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: userData, error: userErr } = await adminSupabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return jsonResponse({ ok: false, message: '유효하지 않은 세션입니다. 다시 로그인해주세요.' }, 401);
    }

    const { data: statusData, error: statusError } = await userSupabase.rpc('get_monthly_chat_token_status', {
      p_month: null,
    });
    if (statusError) throw statusError;
    const statusRow = Array.isArray(statusData) ? statusData[0] : statusData;
    const beforeRemaining = Number(statusRow?.remaining ?? 0) || 0;
    const planId = String(statusRow?.plan_id || 'free');
    const planLimit = Number(statusRow?.limit_value ?? 0) || 0;

    if (beforeRemaining <= 0) {
      return jsonResponse(
        {
          ok: true,
          data: {
            reply: '이번 달 챗봇 토큰을 모두 사용했어요. 플랜 업그레이드 후 다시 이용해주세요.',
            model: 'quota',
            token: { used: planLimit, remaining: 0, limit: planLimit, planId },
          },
        },
        200
      );
    }

    const payload = await req.json().catch(() => ({}));
    const message = String(payload?.message || '').trim();
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const userContext = payload?.userContext && typeof payload.userContext === 'object' ? payload.userContext : null;

    if (!message) {
      return jsonResponse({ ok: false, message: 'message가 비어있습니다.' }, 400);
    }

    if (isDisallowedTopic(message)) {
      return jsonResponse({ ok: true, data: { reply: offTopicReply(message), model: 'policy' } }, 200);
    }

    const model = Deno.env.get('GEMINI_TEXT_MODEL') || Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite';

    const system = buildSystemPrompt();

    const contextPrefix = userContext
      ? `사용자 컨텍스트(참고용):\n${JSON.stringify(userContext).slice(0, 4000)}\n\n`
      : '';

    const contents = toGeminiContents(history, contextPrefix + message);
    const out = await callGeminiText({ system, contents, model });

    const reply = out.text || '답변을 생성하지 못했어요. 질문을 조금 더 구체적으로 해주세요.';

    const usedTokens = out.totalTokens > 0 ? out.totalTokens : estimateTokensFallback(message, reply);

    const { data: consumeData, error: consumeError } = await userSupabase.rpc('consume_monthly_chat_tokens', {
      p_tokens: usedTokens,
      p_month: null,
    });
    if (consumeError) throw consumeError;

    const consumeRow = Array.isArray(consumeData) ? consumeData[0] : consumeData;
    const allowed = Boolean(consumeRow?.allowed);
    const remaining = Number(consumeRow?.remaining ?? 0) || 0;
    const limitValue = Number(consumeRow?.limit_value ?? planLimit) || planLimit;
    const usedValue = Number(consumeRow?.used ?? 0) || 0;

    if (!allowed) {
      return jsonResponse(
        {
          ok: true,
          data: {
            reply: '이번 달 챗봇 토큰을 모두 사용했어요. 플랜 업그레이드 후 다시 이용해주세요.',
            model: 'quota',
            token: { used: usedValue, remaining, limit: limitValue, planId: String(consumeRow?.plan_id || planId) },
          },
        },
        200
      );
    }

    return jsonResponse({
      ok: true,
      data: {
        reply,
        model,
        token: {
          used: usedValue,
          remaining,
          limit: limitValue,
          planId: String(consumeRow?.plan_id || planId),
        },
      },
    }, 200);
  } catch (e: any) {
    return jsonResponse({ ok: false, message: String(e?.message || e || 'UNKNOWN_ERROR') }, 500);
  }
});
