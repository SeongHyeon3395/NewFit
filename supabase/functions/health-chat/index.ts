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

function getBearerToken(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || '';
}

function buildSystemPrompt() {
  return [
    '너는 뉴핏의 “사용자 맞춤 헬스케어 AI 코치”야.',
    '목표는 사용자가 더 건강한 선택을 할 수 있게 식단/운동/생활습관을 현실적으로 코칭하는 것.',
    '',
    '중요(기능 분리):',
    '- 이 챗봇은 “다음 식사/메뉴 추천”, “식단표/식사 계획 제안”을 하지 않는다.',
    '- 사용자가 식사 추천을 요구하더라도, 식사 추천 대신 섭취 기록/목표 대비 분석과 개선 원칙(일반 가이드)만 제공한다.',
    '- 식사/식단 추천이 필요하면 앱의 “식단” 기능을 사용하라고 짧게 안내한다.',
    '',
    '범위(매우 중요):',
    '- 건강, 식단, 음식/영양(먹어도 되는지/안 되는지, 대체 음식, 칼로리/매크로, 알레르기, 생활습관, 운동) 질문에만 답한다.',
    '- 위 범위를 벗어나면 반드시 아래 문장과 비슷하게 거절한다:',
    '  "죄송하지만 저는 건강/식단/음식 관련 질문에만 답할 수 있어요."',
    '- 오프토픽일 때는 다른 내용은 답하지 말고, 건강/식단/음식 질문으로 바꿔달라고 안내한다.',
    '',
    '규칙:',
    '- 질문에 대해 짧고 실행 가능한 답을 먼저 준다.',
    '- 가능하면 선택지(2~4개)로 제시한다.',
    '- 사용자의 목표(감량/유지/증량), 알레르기, 선호가 주어지면 반드시 반영한다.',
    '- 의학적 진단/처방은 하지 말고, 위험 신호가 있으면 전문가 상담을 권한다.',
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

function isAllowedHealthTopic(message: string) {
  const t = normalizeText(message);
  if (!t) return false;

  // 허용 키워드(health/food/diet/exercise)
  const allow = [
    '건강', '헬스', '운동', '식단', '다이어트', '감량', '유지', '증량', '체중', '몸무게', '근육', '체지방',
    '영양', '영양성분', '칼로리', 'kcal', '매크로', '탄수', '탄수화물', '단백질', '지방', '나트륨', '당', '당류',
    '알레르기', '알러지', '혈당', '혈압', '콜레스테롤', '포만감', '소화',
    '음식', '먹어', '먹으면', '먹어도', '먹지', '피해야', '추천', '대체', '간식', '아침', '점심', '저녁',
    'meal', 'diet', 'food', 'nutrition', 'calorie', 'calories', 'protein', 'carb', 'carbs', 'fat', 'sugar', 'sodium',
    'cholesterol', 'fiber', 'allergy', 'allergies', 'digest', 'digestion', 'workout', 'exercise', 'health',
    'lose weight', 'gain weight', 'maintain weight', 'body fat', 'muscle', 'can i eat', 'should i eat', 'is this healthy',
    'healthy', 'snack', 'breakfast', 'lunch', 'dinner', 'ingredient', 'ingredients',
    '健康', '食事', 'ダイエット', '運動', 'カロリー', '栄養', 'たんぱく質', 'タンパク質', '炭水化物', '脂質', '脂肪',
    'アレルギー', '食べて', '食べても', '食べる', '朝ごはん', '昼ごはん', '夕ごはん', '筋トレ',
    '健康', '饮食', '减肥', '增肌', '运动', '卡路里', '热量', '营养', '蛋白质', '碳水', '脂肪', '过敏',
    '可以吃', '能吃', '早餐', '午餐', '晚餐', '零食',
  ];

  // 명확히 오프토픽을 시사하는 키워드(보수적으로)
  const deny = [
    '코딩', '프로그래밍', '자바스크립트', '파이썬', '리액트', 'react', 'typescript', '버그', '에러', '컴파일',
    '주식', '코인', '비트코인', '투자', '부동산',
    '연애', '이별', '썸',
    '법률', '소송', '계약',
    '여행', '항공', '호텔',
    '게임', '롤', '오버워치',
    '영화', '드라마',
    '번역', '숙제', '과제',
  ];

  if (allow.some((k) => t.includes(k))) return true;
  if (deny.some((k) => t.includes(k))) return false;

  // 키워드가 애매하면 안전하게 거절(요구사항: 음식/건강에 대해서만 답변)
  return false;
}

function offTopicReply(message?: string) {
  const lang = detectReplyLanguage(message || '');
  if (lang === 'en') {
    return 'Sorry, I can only help with health, diet, food, nutrition, and exercise related questions.\nFor example: “Can I eat this?”, “Is this meal healthy?”, or “What is a good high-protein snack?”';
  }
  if (lang === 'ja') {
    return '申し訳ありませんが、健康・食事・栄養・運動に関する質問にのみお答えできます。\n例えば: 「これは食べてもいい？」「この食事はヘルシー？」「高たんぱくなおやつは何？」';
  }
  if (lang === 'zh') {
    return '抱歉，我只能回答与健康、饮食、营养和运动相关的问题。\n例如：“这个可以吃吗？”、“这顿饭健康吗？”、“有什么高蛋白零食推荐？”';
  }
  return '죄송하지만 저는 건강/식단/음식 관련 질문에만 답할 수 있어요.\n예) “닭가슴살 대신 뭐가 좋아요?”, “오늘 점심 뭐 먹을까요?”, “이 음식 먹어도 될까요?”';
}

function toGeminiContents(history: any[], latestUserMessage: string) {
  const contents = [] as any[];

  for (const m of history || []) {
    const role = m?.role === 'assistant' ? 'model' : 'user';
    const text = String(m?.text || '').trim();
    if (!text) continue;
    contents.push({ role, parts: [{ text }] });
  }

  const last = String(latestUserMessage || '').trim();
  if (last) contents.push({ role: 'user', parts: [{ text: last }] });

  return contents;
}

async function callGeminiText({ system, contents, model }: { system: string; contents: any[]; model: string }) {
  const apiKey = Deno.env.get('GEMINI_API_KEY') || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 600,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Gemini HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ||
    json?.candidates?.[0]?.content?.parts?.[0]?.text ||
    '';

  return {
    text: String(text || '').trim(),
    raw: json,
    totalTokens: Number(json?.usageMetadata?.totalTokenCount ?? 0) || 0,
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

    if (!isAllowedHealthTopic(message)) {
      return jsonResponse({ ok: true, data: { reply: offTopicReply(message), model: 'policy' } }, 200);
    }

    const model = Deno.env.get('GEMINI_TEXT_MODEL') || Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash-lite';

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
