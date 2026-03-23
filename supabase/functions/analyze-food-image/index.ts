// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

// ... (MacroBlock, parseJsonBlock, callGemini 함수는 기존과 동일하므로 생략 가능하지만 전체 흐름을 위해 유지) ...

function parseJsonBlock(text: string): any {
  const src = String(text ?? '');

  // 1) Strip common markdown fences
  const unfenced = src
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // 2) Extract first balanced JSON object block
  const extractFirstJsonObject = (s: string): string | null => {
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
    return null;
  };

  const jsonBlock = extractFirstJsonObject(unfenced);

  // 3) Try JSON parse
  if (jsonBlock) {
    try {
      const parsed: any = JSON.parse(jsonBlock);
      // Normalize common variants
      if (parsed && typeof parsed === 'object') {
        if (!parsed.dish) {
          const alt = parsed.dishName ?? parsed.dish_name ?? parsed.food ?? parsed.foodName;
          if (typeof alt === 'string' && alt.trim()) parsed.dish = alt.trim();
        }
        if (parsed.dish && typeof parsed.dish === 'object' && typeof parsed.dish.name === 'string') {
          parsed.dish = parsed.dish.name;
        }
      }
      return parsed;
    } catch {
      // fall through to regex salvage
    }
  }

  // 4) Salvage dish/brand from semi-structured output
  const dishMatch = unfenced.match(/"dish"\s*:\s*"([^"\n\r]+)"/i)
    ?? unfenced.match(/\bdish\b\s*[:=]\s*"?([^"\n\r,}]+)"?/i)
    ?? unfenced.match(/음식\s*[:：]\s*([^\n\r]+)$/m);
  const brandMatch = unfenced.match(/"brand"\s*:\s*"([^"\n\r]+)"/i);
  const out: any = { raw: src };
  if (dishMatch && typeof dishMatch[1] === 'string' && dishMatch[1].trim()) out.dish = dishMatch[1].trim();
  if (brandMatch && typeof brandMatch[1] === 'string' && brandMatch[1].trim()) out.brand = brandMatch[1].trim();
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(String(input ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readPromptFromEnv(name: string, b64Name: string): string {
  const direct = (Deno.env.get(name) || '').trim();
  if (direct) return direct;
  const b64 = (Deno.env.get(b64Name) || '').trim();
  if (!b64) return '';
  try {
    // Decode base64 as UTF-8 (atob returns a binary string)
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function readPromptFromEnvWithSource(
  name: string,
  b64Name: string,
): { text: string; source: 'env_direct' | 'env_b64' | 'missing' } {
  const direct = (Deno.env.get(name) || '').trim();
  if (direct) return { text: direct, source: 'env_direct' };
  const b64 = (Deno.env.get(b64Name) || '').trim();
  if (!b64) return { text: '', source: 'missing' };
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { text: new TextDecoder().decode(bytes), source: 'env_b64' };
  } catch {
    return { text: '', source: 'missing' };
  }
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectPromptSection(template: string, sectionName: string, content: string): { text: string; changed: boolean } {
  let text = template;
  let changed = false;

  const placeholderToken = new RegExp(`{{\\s*${escapeRegExp(sectionName)}\\s*}}`, 'g');
  if (placeholderToken.test(text)) {
    text = text.replace(placeholderToken, content);
    changed = true;
  }

  const sectionBlock = new RegExp(
    `(\\[${escapeRegExp(sectionName)}\\]\\s*)(?:<여기는 서버가 자동으로 채웁니다>|<여기는 서버가 자동으로 채웁니다\\.>|<server fills automatically>|<auto-filled by server>)`,
    'gi',
  );
  if (sectionBlock.test(text)) {
    text = text.replace(sectionBlock, `$1${content}`);
    changed = true;
  }

  return { text, changed };
}

function buildPromptFromTemplate(
  template: string,
  sections: Array<{ name: string; content: string }>,
): string {
  let text = String(template || '').trim();
  let changedAny = false;

  for (const section of sections) {
    const next = injectPromptSection(text, section.name, section.content);
    text = next.text;
    changedAny = changedAny || next.changed;
  }

  const hasAllSections = sections.every((section) => text.includes(section.content));
  if (!changedAny || !hasAllSections) {
    const appendix = sections
      .map((section) => `[${section.name}]\n${section.content}`)
      .join('\n\n');
    text = `${text}\n\n${appendix}`.trim();
  }

  return text;
}

function safeNumber(x: any): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function inferDishCategory(dishRaw: any): 'meal' | 'snack' | 'drink' | 'unknown' {
  const dish = typeof dishRaw === 'string' ? dishRaw.toLowerCase() : '';
  if (!dish) return 'unknown';

  // Drinks
  if (/(커피|라떼|아메리카노|주스|스무디|콜라|사이다|탄산|음료|밀크티|차|티|에너지드링크)/i.test(dish)) {
    return 'drink';
  }

  // Snacks / desserts
  if (/(과자|쿠키|초콜릿|젤리|사탕|아이스크림|케이크|도넛|도너츠|빵|베이커리|디저트|스낵|칩|견과|바|프로틴바)/i.test(dish)) {
    return 'snack';
  }

  // Meals
  if (/(밥|덮밥|비빔밥|국|탕|찌개|전골|면|라면|우동|파스타|짜장|짬뽕|피자|버거|햄버거|샌드위치|김밥|도시락|샐러드|스테이크|돈까스|카레|볶음|구이)/i.test(dish)) {
    return 'meal';
  }

  return 'unknown';
}

function buildCategoryDefaultMacros(dishRaw: any) {
  const dish = typeof dishRaw === 'string' ? dishRaw.toLowerCase() : '';

  // Baseline defaults
  let d = {
    calories: 300,
    protein_g: 15,
    carbs_g: 40,
    fat_g: 10,
    sugar_g: 5,
    sodium_mg: 600,
    cholesterol_mg: 30,
    saturated_fat_g: 3,
    trans_fat_g: 0,
  };

  if (!dish) return d;

  if (dish.includes('밥') || dish.includes('덮밥') || dish.includes('비빔밥')) {
    d = { calories: 550, protein_g: 18, carbs_g: 85, fat_g: 12, sugar_g: 8, sodium_mg: 800, cholesterol_mg: 40, saturated_fat_g: 4, trans_fat_g: 0 };
  } else if (dish.includes('라면') || dish.includes('면') || dish.includes('우동') || dish.includes('파스타')) {
    d = { calories: 500, protein_g: 12, carbs_g: 75, fat_g: 15, sugar_g: 5, sodium_mg: 2000, cholesterol_mg: 20, saturated_fat_g: 7, trans_fat_g: 0 };
  } else if (dish.includes('찌개') || dish.includes('국') || dish.includes('탕') || dish.includes('전골')) {
    d = { calories: 400, protein_g: 22, carbs_g: 30, fat_g: 18, sugar_g: 6, sodium_mg: 1200, cholesterol_mg: 50, saturated_fat_g: 6, trans_fat_g: 0 };
  } else if (dish.includes('치킨') || dish.includes('닭')) {
    d = { calories: 700, protein_g: 45, carbs_g: 35, fat_g: 38, sugar_g: 8, sodium_mg: 1400, cholesterol_mg: 120, saturated_fat_g: 10, trans_fat_g: 0 };
  } else if (dish.includes('샐러드')) {
    d = { calories: 200, protein_g: 8, carbs_g: 20, fat_g: 8, sugar_g: 10, sodium_mg: 400, cholesterol_mg: 15, saturated_fat_g: 2, trans_fat_g: 0 };
  } else if (dish.includes('피자') || dish.includes('버거') || dish.includes('햄버거')) {
    d = { calories: 650, protein_g: 25, carbs_g: 60, fat_g: 32, sugar_g: 12, sodium_mg: 1300, cholesterol_mg: 70, saturated_fat_g: 12, trans_fat_g: 0.5 };
  } else if (dish.includes('빵') || dish.includes('케이크') || dish.includes('도넛') || dish.includes('쿠키') || dish.includes('과자') || dish.includes('초콜릿')) {
    d = { calories: 350, protein_g: 6, carbs_g: 50, fat_g: 14, sugar_g: 20, sodium_mg: 300, cholesterol_mg: 25, saturated_fat_g: 7, trans_fat_g: 0 };
  } else if (/(커피|라떼|주스|스무디|콜라|사이다|탄산|음료)/i.test(dish)) {
    d = { calories: 150, protein_g: 2, carbs_g: 30, fat_g: 2, sugar_g: 20, sodium_mg: 50, cholesterol_mg: 5, saturated_fat_g: 1, trans_fat_g: 0 };
  }

  return d;
}

function ensureEstimatedMacrosInPlace(geminiData: any, geminiNoticeRef: { value: string }) {
  if (!geminiData || typeof geminiData !== 'object') return;

  const defaults = buildCategoryDefaultMacros(geminiData?.dish);
  const raw = geminiData.estimated_macros;
  const obj = raw && typeof raw === 'object' ? { ...raw } : {};

  const toNumOrNull = (v: any) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const next: any = {
    calories: toNumOrNull(obj.calories),
    protein_g: toNumOrNull(obj.protein_g),
    carbs_g: toNumOrNull(obj.carbs_g),
    fat_g: toNumOrNull(obj.fat_g),
    sugar_g: toNumOrNull(obj.sugar_g),
    sodium_mg: toNumOrNull(obj.sodium_mg),
    cholesterol_mg: toNumOrNull(obj.cholesterol_mg),
    saturated_fat_g: toNumOrNull(obj.saturated_fat_g),
    trans_fat_g: toNumOrNull(obj.trans_fat_g),
  };

  const hasAnyMeaningful =
    (next.calories ?? 0) > 0 ||
    (next.protein_g ?? 0) > 0 ||
    (next.carbs_g ?? 0) > 0 ||
    (next.fat_g ?? 0) > 0;

  // If model omitted macros entirely or gave zeros, fill all from defaults.
  if (!hasAnyMeaningful) {
    geminiData.estimated_macros = { ...defaults };
    geminiNoticeRef.value = (geminiNoticeRef.value || '') + ' [서버 폴백: 매크로를 카테고리별 평균치로 추정했어요.]';
    return;
  }

  // Otherwise fill missing fields only.
  for (const k of Object.keys(defaults)) {
    if (next[k] === null || next[k] === undefined || (typeof next[k] === 'number' && !Number.isFinite(next[k]))) {
      next[k] = (defaults as any)[k];
    }
  }

  // Guard against negative / nonsense values.
  for (const k of Object.keys(next)) {
    if (typeof next[k] === 'number' && next[k] < 0) next[k] = (defaults as any)[k];
  }

  geminiData.estimated_macros = next;
}

function normalizeUserAnalysisByDishCategory(ua: any, dishRaw: any) {
  if (!ua || typeof ua !== 'object') return ua;
  const category = inferDishCategory(dishRaw);

  const list = Array.isArray((ua as any).alternatives)
    ? (ua as any).alternatives.filter((x: any) => typeof x === 'string' && x.trim())
    : [];

  if (category === 'meal') {
    const mealish = [
      '비슷한 식사 대안: 닭가슴살/생선 + 밥(또는 현미) + 채소',
      '비슷한 식사 대안: 국/찌개류는 국물 적게 + 단백질(두부/계란) 추가',
      '비슷한 식사 대안: 샐러드 + 단백질 토핑(닭/연어/두부) + 소스 최소',
    ];
    (ua as any).alternatives = [...mealish, ...list].slice(0, 6);
  } else if (category === 'snack') {
    const snackish = [
      '간식 대안: 그릭요거트 + 과일',
      '간식 대안: 견과류 한 줌 또는 단백질바(당류 낮은 제품)',
      '간식 대안: 삶은 계란/두유/치즈(소량)',
    ];
    (ua as any).alternatives = [...snackish, ...list].slice(0, 6);
  } else if (category === 'drink') {
    const drinkish = [
      '음료 대안: 무가당 아메리카노/차',
      '음료 대안: 탄산수 + 레몬',
      '음료 대안: 당류 낮은 프로틴 음료(성분표 확인)',
    ];
    (ua as any).alternatives = [...drinkish, ...list].slice(0, 6);
  }

  return ua;
}

function mergeStringListsPreferred(preferred: any, current: any, limit = 6): string[] {
  const first = Array.isArray(preferred)
    ? preferred.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : [];
  const second = Array.isArray(current)
    ? current.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : [];

  return Array.from(new Set([...first, ...second])).slice(0, limit);
}

function buildGenericUserAnalysisFallback(params: {
  dish: string | null;
  estimated_macros: any;
  warningsFromAllergens: string[];
}) {
  const dish = typeof params.dish === 'string' && params.dish.trim() ? params.dish.trim() : '이 음식';
  const macros = params.estimated_macros || {};

  const calories = safeNumber(macros.calories);
  const protein = safeNumber(macros.protein_g);
  const carbs = safeNumber(macros.carbs_g);
  const fat = safeNumber(macros.fat_g);
  const sugar = safeNumber(macros.sugar_g);
  const sodium = safeNumber(macros.sodium_mg);

  const isHighCalories = calories !== null ? calories >= 650 : false;
  const isHighSodium = sodium !== null ? sodium >= 900 : false;
  const isHighSugar = sugar !== null ? sugar >= 18 : false;
  const isHighProtein = protein !== null ? protein >= 25 : false;

  const score = (() => {
    let s = 75;
    if (isHighCalories) s -= 15;
    if (isHighSodium) s -= 15;
    if (isHighSugar) s -= 10;
    if (isHighProtein) s += 5;
    return Math.max(0, Math.min(100, Math.round(s)));
  })();

  const grade = score >= 85 ? 'very_good' : score >= 70 ? 'good' : score >= 55 ? 'neutral' : score >= 40 ? 'bad' : 'very_bad';

  const pros: string[] = [];
  const cons: string[] = [];
  if (isHighProtein) pros.push('단백질이 충분해 포만감/근육 유지에 도움이 될 수 있어요.');
  if (!isHighCalories && calories !== null) pros.push('칼로리가 과하지 않아 무난한 선택일 수 있어요.');
  if (pros.length < 2) pros.push('구성에 따라 균형 잡힌 한 끼로 조절할 수 있어요.');

  if (isHighSodium) cons.push('나트륨이 높은 편이면 혈압/부종 관리에 불리할 수 있어요.');
  if (isHighSugar) cons.push('당류가 높으면 혈당/체지방 관리에 불리할 수 있어요.');
  if (isHighCalories) cons.push('칼로리가 높으면 체중 관리에 부담이 될 수 있어요.');
  while (cons.length < 2) cons.push('정확한 성분표가 아니면 영양값 오차가 있을 수 있어요.');

  const tips0 = `${dish}로 추정했고, 영양정보는 사진/일반정보를 바탕으로 한 추정치예요. (좋은 점) ${pros[0]} (아쉬운 점) ${cons[0]}`;

  const ua: any = {
    grade,
    score100: score,
    pros: pros.slice(0, 4),
    cons: cons.slice(0, 4),
    goalFit: ['목표에 맞게 양(1인분)과 소스를 조절해보세요.', '단백질/채소를 곁들이면 더 균형 잡히기 좋아요.'],
    dietFit: ['성분표가 보이면 1회 섭취량(1인분) 기준으로 확인하는 게 가장 정확해요.', '당/나트륨이 높은 경우 빈도를 줄이거나 대안을 선택해보세요.'],
    healthImpact: ['나트륨/당류가 높으면 장기적으로 건강에 부담이 될 수 있어요.', '균형 잡힌 식단에서 가끔 섭취하는 것은 대체로 괜찮아요.'],
    reasons: ['모델 출력이 불완전할 수 있어 서버가 일부 보정했어요.', '정확한 성분표(OCR)가 없으면 추정치 오차가 생길 수 있어요.'],
    warnings: Array.from(new Set([...(params.warningsFromAllergens || [])])).slice(0, 8),
    alternatives: [],
    tips: [tips0, '포장지 성분표가 보이도록 다시 촬영하면 정확도가 크게 올라가요.', '국물/소스는 줄이고 채소/단백질을 추가하면 더 좋아요.'],
  };

  return normalizeUserAnalysisByDishCategory(ua, dish);
}

function hasMeaningfulUserContext(ctx: any): boolean {
  if (!ctx || typeof ctx !== 'object') return false;
  const keys = Object.keys(ctx);
  if (keys.length === 0) return false;
  return keys.some((k) => {
    const v = (ctx as any)[k];
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });
}

function buildPersonalizedUserAnalysisFallback(params: {
  dish: string | null;
  estimated_macros: any;
  modelAllergens: string[];
  userContext: any;
  warningsFromAllergens: string[];
}) {
  const dish = typeof params.dish === 'string' && params.dish.trim() ? params.dish.trim() : '이 음식';
  const macros = params.estimated_macros || {};

  const calories = safeNumber(macros.calories);
  const protein = safeNumber(macros.protein_g);
  const carbs = safeNumber(macros.carbs_g);
  const fat = safeNumber(macros.fat_g);
  const sugar = safeNumber(macros.sugar_g);
  const sodium = safeNumber(macros.sodium_mg);

  const bodyGoal = params.userContext?.bodyGoal;
  const healthDiet = params.userContext?.healthDiet;
  const lifestyleDiet = params.userContext?.lifestyleDiet;
  const ingredients = Array.isArray(params.userContext?.ingredients) ? params.userContext.ingredients : [];
  const modelAllergens = Array.isArray(params.modelAllergens) ? params.modelAllergens : [];
  const joinedSignals = [dish, ...modelAllergens, ...ingredients].join(' ').toLowerCase();

  const pros: string[] = [];
  const cons: string[] = [];
  const goalFit: string[] = [];
  const dietFit: string[] = [];
  const healthImpact: string[] = [];

  // 단순 임계값(대략) 기반 판단: 표준/100g/1인분이 섞일 수 있으니 과도한 단정은 피함
  const isHighCalories = calories !== null ? calories >= 650 : false;
  const isHighProtein = protein !== null ? protein >= 25 : false;
  const isLowProtein = protein !== null ? protein < 12 : false;
  const isHighCarb = carbs !== null ? carbs >= 60 : false;
  const isHighFat = fat !== null ? fat >= 20 : false;
  const isHighSugar = sugar !== null ? sugar >= 15 : false;
  const isHighSodium = sodium !== null ? sodium >= 700 : false;

  // 목표/식단에 따른 장단점
  if (bodyGoal === 'diet') {
    if (isHighCalories) cons.push('칼로리가 높은 편이라 다이어트 목표에는 부담될 수 있어요.');
    else if (calories !== null) pros.push('칼로리가 과하지 않아 다이어트 목표에 비교적 무난해요.');
    if (isHighCalories) goalFit.push('다이어트 목표라면 양/소스를 조절하는 게 좋아요.');
    else goalFit.push('다이어트 목표 기준으로는 무난한 선택일 수 있어요.');
  }
  if (bodyGoal === 'bulking' || bodyGoal === 'lean_bulk') {
    if (isHighProtein) pros.push('단백질이 충분해 근육/벌크업 목표에 도움이 될 수 있어요.');
    else if (isLowProtein) cons.push('단백질이 낮은 편이라 벌크업 목표에는 아쉬울 수 있어요.');
    if (isHighProtein) goalFit.push('벌크업/린벌크 목표에 필요한 단백질 확보에 도움이 될 수 있어요.');
    else goalFit.push('벌크업 목표라면 단백질을 추가(닭/생선/두부/계란)하는 게 좋아요.');
  }
  if (healthDiet === 'high_protein') {
    if (isHighProtein) pros.push('단백질이 높은 편이라 고단백 식단에 잘 맞아요.');
    else if (isLowProtein) cons.push('단백질이 낮아 고단백 식단 목표에는 부족할 수 있어요.');
    dietFit.push(isHighProtein ? '고단백 식단 기준으로 적합해요.' : '고단백 식단 기준으로는 단백질이 부족할 수 있어요.');
  }
  if (healthDiet === 'low_carb') {
    if (isHighCarb) cons.push('탄수화물이 많은 편이라 저탄수 목표에는 아쉬워요.');
    else if (carbs !== null) pros.push('탄수화물이 과하지 않아 저탄수 목표에 비교적 무난해요.');
    dietFit.push(isHighCarb ? '저탄수 식단 관점에서는 탄수 비중을 줄이는 게 좋아요.' : '저탄수 식단 관점에서 비교적 무난해요.');
  }
  if (healthDiet === 'low_sodium') {
    if (isHighSodium) cons.push('나트륨이 높은 편이라 저염 목표에는 주의가 필요해요.');
    else if (sodium !== null) pros.push('나트륨이 과하지 않아 저염 목표에 비교적 무난해요.');
    dietFit.push(isHighSodium ? '저염 식단 관점에서 소스/국물/가공식품 비중을 줄이세요.' : '저염 식단 관점에서 비교적 무난해요.');
  }
  if (healthDiet === 'low_fat') {
    if (isHighFat) cons.push('지방이 많은 편이라 저지방 목표에는 아쉬워요.');
    else if (fat !== null) pros.push('지방이 과하지 않아 저지방 목표에 비교적 무난해요.');
    dietFit.push(isHighFat ? '저지방 식단 관점에서는 조리법/부위를 바꾸는 게 좋아요.' : '저지방 식단 관점에서 비교적 무난해요.');
  }
  if (healthDiet === 'diabetic') {
    if (isHighSugar || isHighCarb) cons.push('당/탄수 비중이 높아 혈당 관리 관점에서 주의가 필요해요.');
    else if (sugar !== null || carbs !== null) pros.push('당/탄수가 과하지 않아 혈당 관리 관점에서 비교적 무난해요.');
    dietFit.push((isHighSugar || isHighCarb) ? '혈당 관리 관점에서 탄수/당 조절이 필요해요.' : '혈당 관리 관점에서 비교적 무난해요.');
  }
  if (healthDiet === 'intermittent_fasting') {
    if (calories !== null && calories < 350) cons.push('한 끼 열량이 낮아 간헐적 단식 후 식사로는 포만감이 빨리 꺼질 수 있어요.');
    if (isHighProtein) pros.push('단백질이 충분하면 단식 후 식사 포만감 유지에 도움이 돼요.');
    dietFit.push('간헐적 단식 중이라면 한 끼의 포만감과 영양 밀도를 같이 보는 게 좋아요.');
  }
  if (healthDiet === 'anti_inflammatory') {
    if (isHighFat) cons.push('지방이 많은 편이라 항염 식단 관점에서는 조리법과 가공도를 함께 봐야 해요.');
    dietFit.push('항염 식단 관점에서는 가공도와 포화지방, 채소/식이섬유 구성을 함께 확인하세요.');
  }

  if (lifestyleDiet === 'vegetarian' && /(소고기|돼지|닭|치킨|햄|베이컨|육포|고기|불고기|갈비|돈까스|스테이크|참치|연어|새우|게|오징어)/i.test(joinedSignals)) {
    cons.push('채식 식단 기준에서는 동물성 재료 가능성을 확인할 필요가 있어요.');
    dietFit.push('채식 식단이라면 원재료와 육수/토핑의 동물성 재료 포함 여부를 확인하세요.');
  }
  if (lifestyleDiet === 'vegan' && /(우유|치즈|버터|요거트|크림|계란|달걀|소고기|돼지|닭|멸치|참치|연어|새우|굴|꿀)/i.test(joinedSignals)) {
    cons.push('비건 식단 기준에서는 동물성 성분 포함 가능성이 있어 주의가 필요해요.');
    dietFit.push('비건 식단이라면 유제품·달걀·육류·해산물·꿀 포함 여부를 꼭 확인하세요.');
  }
  if (lifestyleDiet === 'ketogenic') {
    if (isHighCarb) cons.push('키토 식단 기준에서는 탄수화물 비중이 높아 적합도가 낮아요.');
    else if (carbs !== null) pros.push('탄수화물 비중이 아주 높지 않아 키토 식단 관점에서 조금 더 무난해요.');
    dietFit.push(isHighCarb ? '키토 식단 기준으로는 탄수화물이 높아 점수를 낮췄어요.' : '키토 식단 기준으로는 탄수화물 비중을 계속 확인하세요.');
  }
  if (lifestyleDiet === 'gluten_free') {
    if (/(밀|밀가루|빵|면|파스타|우동|라면|튀김가루|부침가루)/i.test(joinedSignals)) {
      cons.push('글루텐 프리 식단 기준에서는 밀 성분 가능성이 있어 주의가 필요해요.');
      dietFit.push('글루텐 프리 식단이라면 원재료명과 교차오염 여부를 꼭 확인하세요.');
    } else {
      dietFit.push('글루텐 프리 식단은 사진만으로 완전 판별이 어려워 원재료 확인이 필요해요.');
    }
  }

  // 건강 관점(대략)
  if (isHighSodium) healthImpact.push('나트륨이 높으면 혈압/부종 관리에 불리할 수 있어요.');
  if (isHighSugar) healthImpact.push('당류가 높으면 혈당/체지방 관리에 불리할 수 있어요.');
  if (isHighFat) healthImpact.push('지방이 높으면 총칼로리가 쉽게 올라갈 수 있어요.');
  if (isHighProtein) healthImpact.push('단백질이 충분하면 포만감/근육 유지에 도움이 될 수 있어요.');

  // 컨텍스트가 애매할 때도 최소 1개씩은 채우기
  if (pros.length === 0) {
    if (isHighProtein) pros.push('단백질이 비교적 충분한 편이에요.');
    else if (calories !== null && calories < 500) pros.push('칼로리가 아주 높지 않은 편이에요.');
    else pros.push('사진 기준으로 음식 구성을 추정했어요.');
  }
  if (cons.length === 0) {
    if (isHighSodium) cons.push('나트륨이 높은 편일 수 있어요.');
    else if (isHighCalories) cons.push('칼로리가 높은 편일 수 있어요.');
    else if (isHighSugar) cons.push('당류가 높은 편일 수 있어요.');
    else cons.push('정확한 성분표가 아니면 오차가 있을 수 있어요.');
  }

  // 0~100 점수(사용자 맞춤): 매크로 + 목표/식단에 따른 연속 점수로 계산
  let score100 = 78;

  // 칼로리: 목표별 가중치
  if (calories === null) {
    score100 -= 4;
  } else if (bodyGoal === 'diet') {
    if (calories >= 800) score100 -= 20;
    else if (calories >= 650) score100 -= 15;
    else if (calories >= 500) score100 -= 8;
    else if (calories <= 350) score100 += 5;
  } else if (bodyGoal === 'bulking' || bodyGoal === 'lean_bulk') {
    if (calories <= 350) score100 -= 8;
    else if (calories >= 700) score100 += 5;
  }

  // 단백질: 벌크/고단백 목표에 강하게 반영
  if (protein === null) {
    score100 -= 3;
  } else {
    const wantsProtein = bodyGoal === 'bulking' || bodyGoal === 'lean_bulk' || healthDiet === 'high_protein';
    if (wantsProtein) {
      if (protein >= 35) score100 += 10;
      else if (protein >= 25) score100 += 6;
      else if (protein >= 18) score100 += 2;
      else if (protein < 12) score100 -= 12;
      else score100 -= 6;
    } else {
      if (protein >= 25) score100 += 4;
      else if (protein < 10) score100 -= 5;
    }
  }

  // 나트륨
  if (sodium === null) {
    score100 -= 2;
  } else if (healthDiet === 'low_sodium') {
    if (sodium >= 1200) score100 -= 22;
    else if (sodium >= 900) score100 -= 16;
    else if (sodium >= 700) score100 -= 10;
    else if (sodium <= 500) score100 += 5;
  } else {
    if (sodium >= 1500) score100 -= 10;
    else if (sodium >= 1000) score100 -= 6;
  }

  // 탄수/당
  if (healthDiet === 'low_carb') {
    if (carbs !== null) {
      if (carbs >= 80) score100 -= 20;
      else if (carbs >= 60) score100 -= 14;
      else if (carbs >= 40) score100 -= 7;
      else score100 += 3;
    } else {
      score100 -= 3;
    }
  }

  if (healthDiet === 'diabetic') {
    if (sugar !== null) {
      if (sugar >= 25) score100 -= 22;
      else if (sugar >= 15) score100 -= 14;
    } else {
      score100 -= 3;
    }
    if (carbs !== null) {
      if (carbs >= 70) score100 -= 10;
      else if (carbs >= 55) score100 -= 6;
    }
  } else {
    // 일반적인 경우에도 당/나트륨이 매우 높으면 감점
    if (sugar !== null && sugar >= 25) score100 -= 8;
    if (sodium !== null && sodium >= 1500) score100 -= 6;
  }

  // 지방(저지방 목표)
  if (healthDiet === 'low_fat') {
    if (fat !== null) {
      if (fat >= 30) score100 -= 16;
      else if (fat >= 20) score100 -= 10;
      else score100 += 2;
    } else {
      score100 -= 3;
    }
  }

  if (healthDiet === 'intermittent_fasting') {
    if (calories !== null && calories < 350) score100 -= 6;
    if (protein !== null && protein >= 25) score100 += 4;
  }

  if (healthDiet === 'anti_inflammatory') {
    if (fat !== null && fat >= 28) score100 -= 5;
  }

  if (lifestyleDiet === 'ketogenic') {
    if (carbs !== null) {
      if (carbs >= 60) score100 -= 20;
      else if (carbs >= 40) score100 -= 12;
      else if (carbs <= 20) score100 += 6;
    }
  }

  if (lifestyleDiet === 'vegetarian' && /(소고기|돼지|닭|치킨|햄|베이컨|육포|고기|불고기|갈비|돈까스|스테이크|참치|연어|새우|게|오징어)/i.test(joinedSignals)) {
    score100 -= 18;
  }
  if (lifestyleDiet === 'vegan' && /(우유|치즈|버터|요거트|크림|계란|달걀|소고기|돼지|닭|멸치|참치|연어|새우|굴|꿀)/i.test(joinedSignals)) {
    score100 -= 24;
  }
  if (lifestyleDiet === 'gluten_free' && /(밀|밀가루|빵|면|파스타|우동|라면|튀김가루|부침가루)/i.test(joinedSignals)) {
    score100 -= 18;
  }

  // 알레르기 경고(개인화)
  const allergenWarningsCount = Array.isArray(params.warningsFromAllergens) ? params.warningsFromAllergens.length : 0;
  if (allergenWarningsCount > 0) score100 -= Math.min(25, 12 + allergenWarningsCount * 4);

  // 명확한 충돌은 상한선 적용
  if (bodyGoal === 'diet' && (isHighCalories || isHighSugar || isHighFat)) score100 = Math.min(score100, 64);
  if (healthDiet === 'diabetic' && (isHighSugar || isHighCarb)) score100 = Math.min(score100, 48);
  if (healthDiet === 'low_carb' && isHighCarb) score100 = Math.min(score100, 55);
  if (healthDiet === 'low_sodium' && isHighSodium) score100 = Math.min(score100, 55);
  if (lifestyleDiet === 'ketogenic' && isHighCarb) score100 = Math.min(score100, 45);
  if (lifestyleDiet === 'vegetarian' && /(소고기|돼지|닭|치킨|햄|베이컨|육포|고기|불고기|갈비|돈까스|스테이크|참치|연어|새우|게|오징어)/i.test(joinedSignals)) score100 = Math.min(score100, 35);
  if (lifestyleDiet === 'vegan' && /(우유|치즈|버터|요거트|크림|계란|달걀|소고기|돼지|닭|멸치|참치|연어|새우|굴|꿀)/i.test(joinedSignals)) score100 = Math.min(score100, 25);
  if (lifestyleDiet === 'gluten_free' && /(밀|밀가루|빵|면|파스타|우동|라면|튀김가루|부침가루)/i.test(joinedSignals)) score100 = Math.min(score100, 40);
  if (allergenWarningsCount > 0) score100 = Math.min(score100, 30);

  // 최종 정규화
  score100 = Math.max(0, Math.min(100, Math.round(score100)));

  // 등급: 점수 기반
  const grade: any =
    score100 >= 88 ? 'very_good' :
    score100 >= 75 ? 'good' :
    score100 >= 60 ? 'neutral' :
    score100 >= 45 ? 'bad' :
    'very_bad';

  const atAGlance = `${dish}로 추정했고, 영양정보는 사진/일반정보를 바탕으로 한 추정치예요. (좋은 점) ${pros[0]} (아쉬운 점) ${cons[0]}`;

  const alternatives: string[] = [];
  if (healthDiet === 'low_sodium' || isHighSodium) {
    alternatives.push('국물/소스는 줄이고, 구이/찜처럼 덜 짠 메뉴로 바꿔보세요.');
  }
  if (healthDiet === 'low_carb' || isHighCarb) {
    alternatives.push('밥/면은 절반으로 줄이고 단백질+채소를 늘려보세요.');
  }
  if (healthDiet === 'diabetic' || isHighSugar) {
    alternatives.push('당이 적은 옵션(무가당/소스 적게)으로 바꿔보세요.');
  }
  if (alternatives.length === 0) {
    alternatives.push('단백질(닭/생선/두부)과 채소를 곁들이면 균형이 좋아져요.');
  }

  const tips: string[] = [atAGlance];
  if (isHighSodium) tips.push('가능하면 국물은 남기고, 물을 충분히 드세요.');
  if (isHighCarb) tips.push('후식/음료의 당 섭취는 줄이는 게 좋아요.');
  if (isLowProtein) tips.push('단백질 반찬을 추가하면 더 좋아요.');

  while (pros.length < 2) pros.push('사용자 목표 기준으로 보면 일부 조절 여지는 있지만 활용할 수 있는 선택이에요.');
  while (cons.length < 2) cons.push('정확한 성분표가 아니면 실제 영양값과 차이가 있을 수 있어요.');
  while (goalFit.length < 2) goalFit.push('목표에 맞추려면 1회 섭취량과 곁들이는 메뉴를 함께 조절해보세요.');
  while (dietFit.length < 2) dietFit.push('현재 식단 기준에서는 원재료와 조리법까지 같이 확인하는 게 좋아요.');
  while (healthImpact.length < 2) healthImpact.push('가공도와 소스 양에 따라 건강 영향은 크게 달라질 수 있어요.');

  return {
    grade,
    score100,
    pros,
    cons,
    goalFit,
    dietFit,
    healthImpact,
    reasons: [pros[0], cons[0]],
    warnings: Array.from(new Set([...(params.warningsFromAllergens || [])])),
    alternatives,
    tips,
  };
}

type GeminiErrorResult = {
  error: string;
  status: number;
  retryAfterSeconds?: number;
};

async function callGeminiVision(params: {
  base64: string;
  mime: string;
  model: string;
  apiKey: string;
  prompt: string;
}): Promise<any | GeminiErrorResult> {
  const { base64, mime, model, apiKey, prompt } = params;
  const url = `${GEMINI_OPENAI_BASE_URL}/chat/completions`;
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${base64}` } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;

    const rawText = await res.text().catch(() => '');
    const json = (() => {
      try {
        return rawText ? JSON.parse(rawText) : {};
      } catch {
        return { error: 'JSON Parse Error', raw: rawText };
      }
    })();

    if (res.ok && !json?.error) {
      const text: string | undefined = json?.choices?.[0]?.message?.content;
      if (!text) return { error: 'No text generated.', status: res.status };
      return parseJsonBlock(text);
    }

    const isRateLimited = res.status === 429;
    const isRetryable = isRateLimited || res.status === 503;
    const hasMoreAttempts = attempt < maxAttempts - 1;

    if (isRetryable && hasMoreAttempts) {
      const baseDelayMs = 600;
      const expo = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(0, (retryAfterSeconds as number) * 1000)
        : expo + jitter;

      await sleep(delayMs);
      continue;
    }

    const errDetail = json?.error ? JSON.stringify(json.error) : rawText || 'Unknown error';
    return {
      error: `Gemini API Error (${res.status}): ${errDetail}`,
      status: res.status,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    };
  }

  return { error: 'Gemini API Error: exceeded retry attempts.', status: 429 };
}

async function callGeminiText(params: {
  model: string;
  apiKey: string;
  prompt: string;
}): Promise<any | GeminiErrorResult> {
  const { model, apiKey, prompt } = params;
  const url = `${GEMINI_OPENAI_BASE_URL}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 768,
  };

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;

    const rawText = await res.text().catch(() => '');
    const json = (() => {
      try {
        return rawText ? JSON.parse(rawText) : {};
      } catch {
        return { error: 'JSON Parse Error', raw: rawText };
      }
    })();

    if (res.ok && !json?.error) {
      const text: string | undefined = json?.choices?.[0]?.message?.content;
      if (!text) return { error: 'No text generated.', status: res.status };
      return parseJsonBlock(text);
    }

    const isRateLimited = res.status === 429;
    const isRetryable = isRateLimited || res.status === 503;
    const hasMoreAttempts = attempt < maxAttempts - 1;

    if (isRetryable && hasMoreAttempts) {
      const baseDelayMs = 600;
      const expo = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(0, (retryAfterSeconds as number) * 1000)
        : expo + jitter;

      await sleep(delayMs);
      continue;
    }

    const errDetail = json?.error ? JSON.stringify(json.error) : rawText || 'Unknown error';
    return {
      error: `Gemini API Error (${res.status}): ${errDetail}`,
      status: res.status,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    };
  }

  return { error: 'Gemini API Error: exceeded retry attempts.', status: 429 };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') throw new Error('POST only');
    const form = await req.formData().catch(() => null);
    if (!form) throw new Error('Invalid form');
    const file = form.get('file') as File | null;
    if (!file) throw new Error('File required');

    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = encodeBase64(bytes);
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    // Prefer per-modality model settings; fall back to GEMINI_MODEL; then sensible defaults.
    const visionModel = Deno.env.get('GEMINI_IMAGE_MODEL') || Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-pro';
    const textModel = Deno.env.get('GEMINI_TEXT_MODEL') || Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite';

    // Debug logging
    console.log('[DEBUG] API Key present:', !!apiKey);
    console.log('[DEBUG] Vision Model:', visionModel);
    console.log('[DEBUG] Text Model:', textModel);
    console.log('[DEBUG] Image size (bytes):', bytes.length);

    let geminiData: any = null;
    let geminiNotice = "";
    let promptDebug: any = null;

    // 1. Gemini 호출
    if (!apiKey) {
      console.error('[ERROR] GEMINI_API_KEY is not set');
      return new Response(
        JSON.stringify({ ok: false, message: '서버 설정 오류: GEMINI_API_KEY가 없습니다.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userContextRaw = form.get('userContext');
    const userContext = (() => {
      if (!userContextRaw) return null;
      if (typeof userContextRaw !== 'string') return null;
      try {
        return JSON.parse(userContextRaw);
      } catch {
        return null;
      }
    })();

    const defaultImagePrompt = `당신은 한국의 식품/영양 분석 전문가입니다. 이미지를 분석하여 음식/제품을 식별하고 영양 정보를 JSON으로 반환하세요.

**응답 언어: 무조건 한국어(Korean)**

TARGET SCHEMA:
{
  "dish": string|null,
  "brand": string|null,
  "detections": Array<{ "label": string, "box": { "x": number, "y": number, "width": number, "height": number } }>,
  "ingredients": string[],
  "allergens": string[],
  "estimated_macros": { "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "sugar_g": number, "sodium_mg": number, "cholesterol_mg": number, "saturated_fat_g": number, "trans_fat_g": number },
  "confidence": number,
  "notes": string
}

🚨 **분석 지침 (매우 중요):**
1. **식별 (Identify)**: 이미지 속 음식/제품의 가장 그럴듯한 이름을 정하세요. (예: "김치찌개", "신라면", "스타벅스 아메리카노")
2. **데이터 채우기 (가능한 한 구체적으로) - 절대 비워두지 마세요!**:
  - **1순위 (패키지 OCR)**: 포장지의 영양성분표가 보이면 그 값을 그대로 반영하세요.
  - **2순위 (일반 지식 기반 추정)**: 포장지 텍스트가 없거나 불명확하면, 해당 음식의 **표준 1인분 기준**으로 가장 합리적인 추정치를 채우세요.
  - **🔥 매크로는 절대 0이나 null로 두지 마세요!** 정확한 값을 모르면 유사 음식(예: 같은 카테고리의 평균)이나 일반 상식 기반으로 합리적인 추정치를 반드시 채우세요.
3. **알레르기/성분**: 원재료를 추정하여 알레르기 유발 가능성을 판단하세요.
4. **좌표(detections)**: 이미지 속에서 보이는 음식 구성 요소를 가능한 만큼 나열하고, 각 항목 바운딩 박스를 **정규화 좌표(0~1)** 로 제공하세요.
5. **Notes**: 영양값이 (a) 포장지 OCR 기반인지, (b) 일반 지식 기반 추정인지, (c) 혼합인지 명시하세요.
6. **출력은 JSON만**: 설명 문장/마크다운/코드펜스 없이 JSON 객체 1개만 출력하세요.
`;

    const debugPrompts = ['1', 'true', 'yes', 'on'].includes(
      String(Deno.env.get('DEBUG_PROMPTS') || '').toLowerCase(),
    );

    const imagePromptFromEnv = readPromptFromEnvWithSource('GEMINI_IMAGE_PROMPT', 'GEMINI_IMAGE_PROMPT_B64');
    const imagePrompt = imagePromptFromEnv.text || defaultImagePrompt;
    const imagePromptSource: 'default' | 'env_direct' | 'env_b64' = imagePromptFromEnv.text
      ? imagePromptFromEnv.source
      : 'default';

    let imagePromptSha256: string | undefined;
    if (debugPrompts) {
      imagePromptSha256 = await sha256Hex(imagePrompt);
      promptDebug = {
        imagePrompt: {
          source: imagePromptSource,
          length: imagePrompt.length,
          sha256: imagePromptSha256,
        },
        request: {
          hasUserContextField: Boolean(userContextRaw),
          userContextRawType: typeof (userContextRaw as any),
          userContextRawPreview:
            typeof userContextRaw === 'string'
              ? userContextRaw.slice(0, 200)
              : userContextRaw
                ? '[non-string]'
                : null,
          userContextParsed: Boolean(userContext && typeof userContext === 'object'),
          userContextKeys: userContext && typeof userContext === 'object' ? Object.keys(userContext).slice(0, 20) : [],
          hasMeaningfulUserContext: hasMeaningfulUserContext(userContext),
        },
      };
    }

    console.log('[DEBUG] Calling Gemini Vision API...');
    console.log('[DEBUG] Model:', visionModel);
    console.log('[DEBUG] Prompt length:', imagePrompt.length);
    console.log('[DEBUG] Prompt source:', imagePromptSource);
    if (debugPrompts) {
      console.log('[DEBUG] Prompt sha256:', imagePromptSha256);
    }

    geminiData = await callGeminiVision({
      base64,
      mime: file.type || 'image/jpeg',
      model: visionModel,
      apiKey,
      prompt: imagePrompt,
    });

    console.log('[DEBUG] Gemini Vision response received');
    if (geminiData) {
      console.log('[DEBUG] Response has error:', !!geminiData.error);
      console.log('[DEBUG] Response data:', JSON.stringify(geminiData).substring(0, 300));
    }

    if (geminiData?.error) {
      console.error('[ERROR] Gemini API Error:', geminiData.error);
      console.error('[ERROR] Status:', geminiData.status);
      
      const status = typeof geminiData.status === 'number' ? geminiData.status : 502;
      const is429 = status === 429;

      const debugEnabled = ['1', 'true', 'yes', 'on'].includes(String(Deno.env.get('DEBUG_GEMINI_ERRORS') || '').toLowerCase());

      const debugObj = (debugEnabled || debugPrompts)
        ? {
            ...(debugEnabled ? { geminiError: String(geminiData.error || '') } : null),
            ...(debugPrompts ? { prompts: promptDebug } : null),
          }
        : undefined;

      return new Response(
        JSON.stringify({
          ok: false,
          code: status,
          message: is429
            ? '요청이 많아서 AI 분석이 지연되고 있어요. 잠시 후 다시 시도해주세요. (Gemini 429)'
            : 'AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          model: visionModel,
          textModel,
          debug: debugObj,
          retryAfterSeconds: geminiData.retryAfterSeconds,
        }),
        {
          status: is429 ? 429 : 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // 2. DB 검색 및 데이터 교체 로직
    let dbFood: any = null;
    let source = "AI Vision Analysis";
    let referenceStandard = "Per Package/Serving"; 

    if (geminiData && geminiData.dish) {
      const searchTerm = geminiData.dish.split(' ').join(' & ');
      const cleanName = geminiData.dish.replace(/[^\w\s가-힣]/g, '').trim();

      // 2-1. 가공식품 DB (food_nutrition) 검색
      const { data: processedResults } = await supabase
        .from('food_nutrition')
        .select('*')
        .textSearch('name', searchTerm, { config: 'simple', type: 'websearch' })
        .limit(1);

      // 2-2. 일반음식 DB (foot_normal) 검색 - 가공식품에 없을 경우
      let generalResults: any[] = [];
      if (!processedResults || processedResults.length === 0) {
         const { data: normalResults } = await supabase
          .from('foot_normal')
          .select('*')
          .or(`name.ilike.%${cleanName}%,name.textSearch.${cleanName}`)
          .limit(1);
         if (normalResults) generalResults = normalResults;
      }

      if (processedResults && processedResults.length > 0) {
        // [CASE A] 가공식품 DB 발견
        dbFood = processedResults[0];
        source = "Supabase DB (Processed Food)";
        referenceStandard = "100g 기준 (Per 100g)"; 

        geminiData.brand = dbFood.brand || null;
        geminiData.estimated_macros = {
          calories: dbFood.calories,
          protein_g: dbFood.protein,
          carbs_g: dbFood.carbs,
          fat_g: dbFood.fat,
          sugar_g: dbFood.sugar,
          sodium_mg: dbFood.sodium,
          cholesterol_mg: dbFood.cholesterol,
          saturated_fat_g: dbFood.saturated_fat, 
          trans_fat_g: dbFood.trans_fat
        };

        if (dbFood.brand) {
             geminiData.dish = `${dbFood.brand} ${dbFood.name}`;
        } else {
             geminiData.dish = dbFood.name;
        }
        geminiNotice = `[데이터베이스 연동됨] 가공식품 DB에서 정확한 성분표를 가져왔습니다. (100g 기준)`;

      } else if (generalResults && generalResults.length > 0) {
        // [CASE B] 일반음식 DB 발견 (foot_normal)
        dbFood = generalResults[0];
        source = "Supabase DB (General Food)";
        referenceStandard = "100g 기준 (Per 100g)";

        // 일반음식은 브랜드가 보통 없음
        geminiData.brand = null; 
        
        // foot_normal 테이블 컬럼 매핑 (사용자 DB 스키마에 따라 수정 필요할 수 있음, 여기선 food_nutrition과 유사하다고 가정)
        // 만약 컬럼명이 다르다면 여기서 수정해야 합니다. 예: energy -> calories
        geminiData.estimated_macros = {
          calories: dbFood.calories || dbFood.energy, // 컬럼명 대응
          protein_g: dbFood.protein,
          carbs_g: dbFood.carbs || dbFood.carbohydrate,
          fat_g: dbFood.fat,
          sugar_g: dbFood.sugar,
          sodium_mg: dbFood.sodium,
          cholesterol_mg: dbFood.cholesterol,
          saturated_fat_g: dbFood.saturated_fat,
          trans_fat_g: dbFood.trans_fat
        };

        geminiData.dish = dbFood.name;
        geminiNotice = `[데이터베이스 연동됨] 일반음식 DB에서 성분표를 가져왔습니다. (100g 기준)`;

      } else {
        // [CASE C] DB 미발견 -> AI 추정치 사용
        source = "AI Estimation (DB Not Found)";
        referenceStandard = "AI Estimate / Package Label";
        geminiNotice = `[DB 미발견] AI가 패키지를 읽거나 인터넷 지식을 기반으로 추정했습니다.`;
      }
    }

    // 3. 매크로 최종 보정 (모델이 비우거나 0으로 준 경우에도 항상 폴백 적용)
    const geminiNoticeRef = { value: geminiNotice };
    ensureEstimatedMacrosInPlace(geminiData, geminiNoticeRef);
    geminiNotice = geminiNoticeRef.value;

    // 4. 최종 데이터 반환 구성
    // 사용자 알레르기(컨텍스트)가 있으면 warnings에 보정(모델 누락 방지)
    const userAllergens: string[] = Array.isArray((userContext as any)?.allergens)
      ? (userContext as any).allergens.filter((x: any) => typeof x === 'string')
      : [];
    const modelAllergens: string[] = Array.isArray(geminiData?.allergens)
      ? geminiData.allergens.filter((x: any) => typeof x === 'string')
      : [];
    const warningsFromAllergens = userAllergens
      .filter(a => modelAllergens.some((m: string) => m.includes(a) || a.includes(m)))
      .map(a => `알레르기 주의: ${a}`);

    // 4-1. 사용자 맞춤 분석(userAnalysis)은 텍스트 모델(Lite)로 별도 생성
    const hasCtx = hasMeaningfulUserContext(userContext);
    if (hasCtx && apiKey) {
      const defaultAssistantPrompt = `역할: 한국어 영양 상담/비서.

입력([분석 결과], [사용자 컨텍스트])을 근거로 아래 스키마의 JSON 객체 1개만 출력.
금지: 설명/마크다운/코드펜스/추가 키.

SCHEMA(userAnalysis)
{"grade":"very_good"|"good"|"neutral"|"bad"|"very_bad","score100":number,"pros":string[],"cons":string[],"goalFit":string[],"dietFit":string[],"healthImpact":string[],"reasons":string[],"warnings":string[],"alternatives":string[],"tips":string[]}

핵심 원칙
- 반드시 [사용자 컨텍스트]를 최우선으로 반영한다.
- 일반적으로 건강해 보여도 사용자의 목표/식단과 충돌하면 점수와 문구를 명확히 낮춘다.
- 목표/식단과 충돌하는 경우, goalFit/dietFit/reasons에 그 충돌을 직접 쓴다.
- 애매하게 좋다고 말하지 말고 맞는 이유와 안 맞는 이유를 분명히 적는다.

강한 판정 규칙
- 다이어트(bodyGoal=diet)인데 칼로리·당류·지방이 높으면 65점 이상으로 쓰지 말 것.
- 혈당 관리(healthDiet=diabetic)인데 당류 또는 탄수화물이 높으면 50점 이상으로 쓰지 말 것.
- 저탄수(healthDiet=low_carb) 또는 키토(lifestyleDiet=ketogenic)인데 탄수화물이 높으면 높은 점수를 주지 말 것.
- 저염(healthDiet=low_sodium)인데 나트륨이 높으면 높은 점수를 주지 말 것.
- 알레르기 경고가 있으면 안전성 때문에 점수를 크게 낮춘다.
- 채식/비건/글루텐프리와 충돌 가능성이 보이면 warnings와 dietFit에 반드시 반영한다.

제약
- score100: 0~100 정수
- pros/cons/goalFit/dietFit/healthImpact: 각 배열 길이 ≥ 2
- tips[0]: 2~3문장(한국어, 짧고 직관적)이며 반드시 포함
  1) 음식 이름을 "~로 추정" 표현
  2) 영양정보는 "추정치"임을 고지
  3) 좋은 점 1개 + 아쉬운 점 1개

[분석 결과]
{{분석 결과}}

[사용자 컨텍스트]
{{사용자 컨텍스트}}
`;

      const assistantPromptFromEnv = readPromptFromEnvWithSource(
        'GEMINI_ASSISTANT_PROMPT',
        'GEMINI_ASSISTANT_PROMPT_B64',
      );
      const assistantPrompt = assistantPromptFromEnv.text || defaultAssistantPrompt;
      const analysisPayload = JSON.stringify(
        {
          dish: geminiData?.dish ?? null,
          brand: geminiData?.brand ?? null,
          estimated_macros: geminiData?.estimated_macros ?? null,
          ingredients: Array.isArray(geminiData?.ingredients) ? geminiData.ingredients : [],
          allergens: Array.isArray(geminiData?.allergens) ? geminiData.allergens : [],
          notes: geminiData?.notes ?? geminiNotice,
        },
        null,
        2,
      );
      const userContextPayload = JSON.stringify(userContext, null, 2);
      const assistantPromptFilled = buildPromptFromTemplate(assistantPrompt, [
        { name: '분석 결과', content: analysisPayload },
        { name: '사용자 컨텍스트', content: userContextPayload },
      ]);
      const assistantPromptSource: 'default' | 'env_direct' | 'env_b64' = assistantPromptFromEnv.text
        ? assistantPromptFromEnv.source
        : 'default';

      let assistantPromptSha256: string | undefined;
      if (debugPrompts) {
        assistantPromptSha256 = await sha256Hex(assistantPromptFilled);
        promptDebug = promptDebug || {};
        promptDebug.assistantPrompt = {
          source: assistantPromptSource,
          length: assistantPromptFilled.length,
          sha256: assistantPromptSha256,
        };
      }

      console.log('[DEBUG] Assistant prompt length:', assistantPromptFilled.length);
      console.log('[DEBUG] Assistant prompt source:', assistantPromptSource);
      if (debugPrompts) {
        console.log('[DEBUG] Assistant prompt sha256:', assistantPromptSha256);
      }

      const uaResult = await callGeminiText({
        model: textModel,
        apiKey,
        prompt: assistantPromptFilled,
      });

      if (uaResult && !uaResult.error) {
        geminiData.userAnalysis = uaResult;
      }
    }

    const mergedUserAnalysis = (() => {
      const ua = geminiData?.userAnalysis;

      // 1) 모델이 userAnalysis를 아예 안 준 경우: 컨텍스트가 있으면 personalized, 없으면 generic 폴백
      if (!ua) {
        const fallback = hasCtx
          ? buildPersonalizedUserAnalysisFallback({
              dish: geminiData?.dish ?? null,
              estimated_macros: geminiData?.estimated_macros,
              modelAllergens,
              userContext,
              warningsFromAllergens,
            })
          : buildGenericUserAnalysisFallback({
              dish: geminiData?.dish ?? null,
              estimated_macros: geminiData?.estimated_macros,
              warningsFromAllergens,
            });

        return normalizeUserAnalysisByDishCategory(fallback, geminiData?.dish ?? null);
      }

      // 2) 모델이 줬지만 내용이 빈 경우: tips[0]/reasons를 보정
      const next: any = { ...ua };
      const warnings = Array.isArray(next.warnings) ? next.warnings.filter((x: any) => typeof x === 'string') : [];
      next.warnings = Array.from(new Set([...warningsFromAllergens, ...warnings]));

      if (hasCtx) {
        const fallback = buildPersonalizedUserAnalysisFallback({
          dish: geminiData?.dish ?? null,
          estimated_macros: geminiData?.estimated_macros,
          modelAllergens,
          userContext,
          warningsFromAllergens,
        });

        // 사용자 컨텍스트가 있으면 점수/등급은 서버 계산값으로 항상 고정(모델이 75로 고정 출력하는 문제 방지)
        (next as any).score100 = fallback.score100;
        (next as any).grade = fallback.grade;

        const tips = Array.isArray(next.tips) ? next.tips.filter((x: any) => typeof x === 'string' && x.trim()) : [];
        if (tips.length === 0) {
          next.tips = fallback.tips;
        } else {
          // 한눈에 보기(tips[0])는 사용자 맞춤 요약으로 강제(기존 팁은 뒤로 유지)
          next.tips = [fallback.tips[0], ...tips.slice(0, 5)];
        }

        next.reasons = mergeStringListsPreferred(fallback.reasons, next.reasons);
        next.alternatives = mergeStringListsPreferred(fallback.alternatives, next.alternatives);
        (next as any).pros = mergeStringListsPreferred(fallback.pros, (next as any).pros);
        (next as any).cons = mergeStringListsPreferred(fallback.cons, (next as any).cons);
        (next as any).goalFit = mergeStringListsPreferred(fallback.goalFit, (next as any).goalFit);
        (next as any).dietFit = mergeStringListsPreferred(fallback.dietFit, (next as any).dietFit);
        (next as any).healthImpact = mergeStringListsPreferred(fallback.healthImpact, (next as any).healthImpact);
        next.warnings = mergeStringListsPreferred(warningsFromAllergens, next.warnings, 8);
      }

      // 컨텍스트가 없거나 모델이 이상한 대안을 준 경우에도 음식 카테고리에 맞게 대안 보정
      normalizeUserAnalysisByDishCategory(next, geminiData?.dish ?? null);

      // tips[0]에 음식명이 아예 없으면 폴백 tips[0]로 보정(가끔 "이 음식 로" 같은 형태 방지)
      try {
        const dishStr = typeof geminiData?.dish === 'string' ? geminiData.dish.trim() : '';
        const t0 = Array.isArray(next.tips) && typeof next.tips[0] === 'string' ? next.tips[0] : '';
        if (dishStr && t0 && !t0.includes(dishStr)) {
          const generic = buildGenericUserAnalysisFallback({
            dish: dishStr,
            estimated_macros: geminiData?.estimated_macros,
            warningsFromAllergens,
          });
          next.tips = [generic.tips[0], ...(Array.isArray(next.tips) ? next.tips.slice(0, 5) : [])];
        }
      } catch {
        // ignore
      }

      return next;
    })();

    const normalizedDish = (() => {
      const raw = (geminiData as any)?.dish;
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
      if (raw && typeof raw === 'object') {
        const name = (raw as any)?.name;
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
      const labels = Array.isArray((geminiData as any)?.detections)
        ? (geminiData as any).detections
            .map((d: any) => (typeof d?.label === 'string' ? d.label.trim() : (typeof d?.name === 'string' ? d.name.trim() : '')))
            .filter((s: string) => Boolean(s))
        : [];
      return labels.length > 0 ? labels[0] : null;
    })();

    const data = {
      kind: 'food',
      version: 'v12-personalized-usercontext',
      model: visionModel,
      textModel,
      source,
      reference_standard: referenceStandard,
      dish: normalizedDish,
      
      
      // 🚨 [핵심 수정] 여기에 brand 필드를 반드시 포함시켜야 프론트엔드로 나갑니다.
      brand: geminiData?.brand ?? null,

      // 좌표 기반 오버레이용: 0~1 정규화 좌표
      detections: Array.isArray(geminiData?.detections)
        ? geminiData.detections
            .filter((d: any) => d && typeof d === 'object')
            .map((d: any) => ({
              label: typeof d.label === 'string' ? d.label : (typeof d.name === 'string' ? d.name : ''),
              box: {
                x: clamp01(typeof d?.box?.x === 'number' ? d.box.x : (typeof d?.bbox?.x === 'number' ? d.bbox.x : 0)),
                y: clamp01(typeof d?.box?.y === 'number' ? d.box.y : (typeof d?.bbox?.y === 'number' ? d.bbox.y : 0)),
                width: clamp01(typeof d?.box?.width === 'number' ? d.box.width : (typeof d?.bbox?.width === 'number' ? d.bbox.width : 0)),
                height: clamp01(typeof d?.box?.height === 'number' ? d.box.height : (typeof d?.bbox?.height === 'number' ? d.bbox.height : 0)),
              },
            }))
            .map((d: any) => {
              // Keep the box inside image bounds
              const x = clamp01(d.box.x);
              const y = clamp01(d.box.y);
              const width = clamp01(Math.min(d.box.width, 1 - x));
              const height = clamp01(Math.min(d.box.height, 1 - y));
              return { ...d, box: { x, y, width, height } };
            })
            .filter((d: any) => d.label && d.box && d.box.width > 0 && d.box.height > 0)
        : [],

      ingredients: Array.isArray(geminiData?.ingredients) ? geminiData.ingredients : [],
      allergens: Array.isArray(geminiData?.allergens) ? geminiData.allergens : [],
      estimated_macros: geminiData?.estimated_macros,
      userAnalysis: mergedUserAnalysis,
      confidence: typeof geminiData?.confidence === 'number' ? geminiData.confidence : 0,
      notes: geminiData?.notes || geminiNotice,
      fileMeta: { name: file.name, size: file.size, type: file.type },
      geminiUsed: Boolean(apiKey),
    };

    return new Response(
      JSON.stringify({ ok: true, data, debug: debugPrompts ? { prompts: promptDebug } : undefined }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, message: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});