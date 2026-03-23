// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

function json(resBody: any, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function parseJsonBlock(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function safeArrayStrings(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v ?? '').trim()).filter(Boolean);
}

function filterUnsafePantryItems(items: string[]): string[] {
  const blocked = [
    // drugs
    /\b(cocaine|heroin|meth|methamphetamine|lsd|ecstasy)\b/i,
    /(마약|대마|대마초|코카인|필로폰|히로뽕|헤로인|엑스터시|케타민)/i,
    // chemicals/poisons
    /(락스|표백제|세제|세정제|청소(용)?품|살충제|농약|제초제|페인트|시너|접착제|본드|부동액|휘발유|경유|등유)/i,
    /(독약|독극물|청산가리|비소|수은|납)/i,
    // tobacco/vape/alcohol (non-food)
    /(담배|전자담배|궐련|시가|니코틴|베이프)/i,
    /\b(vape|cigarette|tobacco|nicotine)\b/i,
    /(술|소주|맥주|와인|위스키|보드카|막걸리|사케|칵테일|샴페인)/i,
    /\b(beer|soju|wine|whisky|whiskey|vodka|sake|cocktail|champagne)\b/i,
  ];

  return items
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .filter((s) => !blocked.some((re) => re.test(s)));
}

function normalizeName(s: any) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractMealNamesFromResult(result: any): string[] {
  const plan = Array.isArray(result?.plan) ? result.plan : [];
  const names: string[] = [];
  for (const day of plan) {
    const meals = day?.meals;
    const candidates = [meals?.breakfast?.name, meals?.lunch?.name, meals?.dinner?.name];
    for (const c of candidates) {
      const s = String(c ?? '').trim();
      if (s) names.push(s);
    }
  }
  return names;
}

function findOverlaps(names: string[], avoidFoods: string[]): string[] {
  const avoid = new Set(avoidFoods.map(normalizeName).filter(Boolean));
  const overlaps = new Set<string>();
  for (const n of names) {
    const key = normalizeName(n);
    if (key && avoid.has(key)) overlaps.add(String(n));
  }
  return Array.from(overlaps);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function buildStubPlan(params: { days: number; mode: string; avoidFoods?: string[]; nonce?: string }) {
  const days = clampInt(params.days, 1, 3, 1);
  const avoidFoods = safeArrayStrings(params.avoidFoods);
  const nonce = String(params.nonce || '');

  const pickFromPool = (pool: string[], fallback: string) => {
    const filtered = pool.filter((x) => !avoidFoods.map(normalizeName).includes(normalizeName(x)));
    const src = filtered.length > 0 ? filtered : pool;
    const baseIdx = Math.abs(
      (nonce ? Array.from(nonce).reduce((acc, c) => acc + c.charCodeAt(0), 0) : Date.now()) % 997
    );
    const item = src[baseIdx % src.length] || fallback;
    // If pool is exhausted, append a small variant tag to reduce duplicates.
    if (filtered.length === 0 && avoidFoods.length > 0) return `${item} (변형)`;
    return item;
  };

  const mkMeal = (name: string, grams: number, calories: number, carbs: number, protein: number, fat: number) => ({
    name,
    grams,
    macros: { calories, carbs_g: carbs, protein_g: protein, fat_g: fat },
  });

  const breakfastPool = ['오트밀 + 그릭요거트', '계란스크램블 + 토스트', '두부 스크램블 + 샐러드', '바나나 + 견과 + 요거트'];
  const lunchPool = ['닭가슴살 샐러드 + 밥 반 공기', '연어덮밥(가벼운 버전)', '두부덮밥 + 김치', '참치샐러드 + 고구마'];
  const dinnerPool = ['연어구이 + 구운 채소', '닭가슴살 볶음 + 야채', '두부스테이크 + 샐러드', '돼지등심 구이 + 채소'];

  const planDays = Array.from({ length: days }).map((_, idx) => {
    const day = idx + 1;
    const breakfastName = pickFromPool(breakfastPool, '오트밀 + 그릭요거트');
    const lunchName = pickFromPool(lunchPool, '닭가슴살 샐러드');
    const dinnerName = pickFromPool(dinnerPool, '연어구이 + 구운 채소');

    const breakfast = mkMeal(breakfastName, 420, 430, 55, 25, 12);
    const lunch = mkMeal(lunchName, 550, 520, 50, 40, 14);
    const dinner = mkMeal(dinnerName, 520, 580, 25, 45, 30);
    const totals = {
      calories: breakfast.macros.calories + lunch.macros.calories + dinner.macros.calories,
      carbs_g: breakfast.macros.carbs_g + lunch.macros.carbs_g + dinner.macros.carbs_g,
      protein_g: breakfast.macros.protein_g + lunch.macros.protein_g + dinner.macros.protein_g,
      fat_g: breakfast.macros.fat_g + lunch.macros.fat_g + dinner.macros.fat_g,
    };

    return {
      day,
      meals: { breakfast, lunch, dinner },
      totals,
    };
  });

  return {
    ok: true,
    data: {
      mode: params.mode,
      days,
      plan: planDays,
      notes: [
        '이 결과는 예시(stub)입니다. Edge Function 환경변수에 GEMINI_API_KEY를 설정하면 실제 AI 식단이 생성됩니다.',
      ],
    },
  };
}

async function callGeminiText(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!apiKey) throw new Error('MISSING_GEMINI_API_KEY');

  const model = Deno.env.get('GEMINI_TEXT_MODEL') ?? Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite';
  const url = `${GEMINI_OPENAI_BASE_URL}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 2048,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(json?.error?.message || json?.message || `HTTP ${res.status}`);
    throw new Error(msg);
  }

  const text = String(json?.choices?.[0]?.message?.content || '');
  return String(text || '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const mode = String(body?.mode || 'general');
    const days = clampInt(body?.days, 1, 3, 1);
    const pantryItems = filterUnsafePantryItems(safeArrayStrings(body?.pantryItems));
    const userContext = body?.userContext ?? null;
    const avoidFoods = safeArrayStrings(body?.avoidFoods);
    const nonce = String(body?.nonce || '');

    // If no key, return stub (keeps mobile dev unblocked).
    const apiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!apiKey) {
      return json(buildStubPlan({ days, mode, avoidFoods, nonce }));
    }

    const avoidBlock =
      avoidFoods.length > 0
        ? `\n\n중요: 아래 '금지 음식/메뉴명'과 완전히 동일한 name을 절대 사용하지 마세요(대소문자/공백 무시).\n금지 음식/메뉴명: ${JSON.stringify(
            avoidFoods
          )}`
        : '';

    const promptBase = `당신은 한국인의 건강 목표에 맞춘 '식단 플래너'입니다.

응답 언어: 무조건 한국어

아래 JSON 스키마를 '정확히' 따르는 JSON만 반환하세요. 다른 텍스트는 절대 출력하지 마세요.

SCHEMA:
{
  "mode": "pantry" | "general",
  "days": 1 | 2 | 3,
  "plan": Array<{
    "day": number,
    "meals": {
      "breakfast": { "name": string, "grams": number, "macros": { "calories": number, "carbs_g": number, "protein_g": number, "fat_g": number } },
      "lunch":     { "name": string, "grams": number, "macros": { "calories": number, "carbs_g": number, "protein_g": number, "fat_g": number } },
      "dinner":    { "name": string, "grams": number, "macros": { "calories": number, "carbs_g": number, "protein_g": number, "fat_g": number } }
    },
    "totals": { "calories": number, "carbs_g": number, "protein_g": number, "fat_g": number }
  }>,
  "notes": string[]
}

제약:
- 끼니별 grams는 50~900 범위의 현실적인 숫자
- macros는 끼니별/하루 합이 논리적으로 맞아야 함
- mode=pantry이면 아래 pantryItems에서 최대한 재료/음식명을 활용(부족하면 일반 재료로 보완 가능)
- 사용자 알레르기(userContext.allergens)가 있으면 해당 알레르겐이 포함된 메뉴는 피하거나 대체안 제시

INPUT:
mode=${mode}
days=${days}
pantryItems=${JSON.stringify(pantryItems)}
userContext=${JSON.stringify(userContext)}
nonce=${JSON.stringify(nonce)}
${avoidBlock}
`;

    const runOnce = async (prompt: string) => {
      const text = await callGeminiText(prompt);
      const parsed = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return parseJsonBlock(text);
        }
      })();
      return parsed;
    };

    let parsed = await runOnce(promptBase);

    // If model violated avoidFoods, retry once with stronger instruction.
    if (avoidFoods.length > 0 && parsed && typeof parsed === 'object') {
      const names = extractMealNamesFromResult(parsed);
      const overlaps = findOverlaps(names, avoidFoods);
      if (overlaps.length > 0) {
        const retryPrompt = `${promptBase}\n\n[재요청]\n방금 응답에서 금지 음식/메뉴명이 포함되었습니다: ${JSON.stringify(
          overlaps
        )}\n반드시 금지 목록을 준수하여 새로운 JSON을 다시 생성하세요.`;
        parsed = await runOnce(retryPrompt);
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return json({ ok: false, message: 'AI 응답을 JSON으로 파싱하지 못했습니다.' }, 502);
    }

    return json({ ok: true, data: parsed });
  } catch (e: any) {
    const msg = String(e?.message || e || 'UNKNOWN_ERROR');
    return json({ ok: false, message: msg }, 500);
  }
});
