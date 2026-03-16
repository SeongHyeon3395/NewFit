import React, { useMemo, useState } from 'react';
import { BackHandler, View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Modal, LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { COLORS } from '../../constants/colors';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { AppIcon } from '../../components/ui/AppIcon';
import { useAppAlert } from '../../components/ui/AppAlert';
import { useAppToast } from '../../components/ui/AppToast';
import { ManualLogEditor } from '../../components/editor/ManualLogEditor';
import { useUserStore } from '../../store/userStore';
import { captureError, logEvent } from '../../services/telemetry';
import { getFoodScore100 } from '../../services/foodScore';
import { ensureUserAnalysis } from '../../services/userAnalysis';
import { computeAllergenHits } from '../../services/allergen';
import { useTheme } from '../../theme/ThemeProvider';
import { getSessionUserId, insertManualMealLogRemote, listManualMealLogsRemote } from '../../services/userData';

import { FoodAnalysis, GRADE_COLORS, ManualMealLog } from '../../types/user';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

async function fileUriToBase64(uri: string): Promise<string | null> {
  const normalized = String(uri || '').trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) return null;

  try {
    const response = await fetch(normalized);
    const blob = await response.blob();

    return await new Promise<string | null>((resolve) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const idx = result.indexOf('base64,');
          resolve(idx >= 0 ? result.slice(idx + 'base64,'.length) : (result || null));
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

function isUnknownDishName(dishName: unknown): boolean {
  const s = String(dishName ?? '').trim().toLowerCase();
  if (!s) return true;
  return s === '알 수 없는 음식' || s.includes('알 수 없는') || s.includes('알수없는') || s.includes('unknown');
}

export default function ResultScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { imageUri, analysis, readOnly } = route.params as { imageUri: string; analysis: FoodAnalysis; readOnly?: boolean };
  const isReadOnly = Boolean(readOnly);

  const unknownFood = isUnknownDishName(analysis?.dishName);

  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [imageBox, setImageBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const { alert, dismiss } = useAppAlert();
  const { toast } = useAppToast();
  const { colors, isDark } = useTheme();

  const profile = useUserStore(state => state.profile);
  const setManualMealLogs = useUserStore(state => state.setManualMealLogs);
  const score100 = unknownFood ? 0 : getFoodScore100(analysis);

  const listOrEmpty = (arr: any): string[] =>
    Array.isArray(arr) ? arr.filter((x: any) => typeof x === 'string' && x.trim()) : [];

  const ua: any = analysis.userAnalysis || ensureUserAnalysis(analysis, profile);
  const pros = listOrEmpty(ua?.pros);
  const cons = listOrEmpty(ua?.cons);
  const goalFit = listOrEmpty(ua?.goalFit);
  const dietFit = listOrEmpty(ua?.dietFit);
  const healthImpact = listOrEmpty(ua?.healthImpact);
  const warnings = listOrEmpty(ua?.warnings);
  const alternatives = listOrEmpty(ua?.alternatives);
  const tips = listOrEmpty(ua?.tips);
  const ingredientTags = listOrEmpty((analysis as any)?.ingredients);

  const inlineTags = useMemo(() => {
    const labelsFromDetections = Array.isArray((analysis as any).detections)
      ? (analysis as any).detections
          .map((d: any) => (typeof d?.label === 'string' ? d.label.trim() : ''))
          .filter(Boolean)
      : [];

    const uniq = (arr: string[]) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const s of arr) {
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      return out;
    };

    const base = labelsFromDetections.length > 0 ? labelsFromDetections : ingredientTags;
    return uniq(base).slice(0, 24);
  }, [analysis, ingredientTags]);

  const inlineTagsPreview = useMemo(() => inlineTags.slice(0, 4), [inlineTags]);
  const hasMoreInlineTags = inlineTags.length > 4;

  const detections = Array.isArray((analysis as any).detections) ? (analysis as any).detections : [];
  const hasDetections = detections.length > 0 && imageBox.width > 0 && imageBox.height > 0;

  // The white content panel overlaps the image header by ~24px (see styles.content.marginTop).
  // Keep overlays above that overlap so tags don't get hidden.
  const overlayBottomGuard = 44;

  // NOTE: detection/ingredient chips are intentionally not shown on top of the image.

  const onImageHeaderLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setImageBox({ width, height });
  };

  const requestExit = () => setShowExitConfirm(true);

  const goToScan = () => {
    const nav: any = navigation as any;
    if (typeof nav?.reset === 'function') {
      nav.reset({ index: 0, routes: [{ name: 'MainTab', params: { screen: 'Scan' } }] });
      return;
    }
    nav.navigate?.('MainTab', { screen: 'Scan' });
  };

  const goToReshoot = () => {
    const nav: any = navigation as any;
    const rootNav = nav?.getParent?.() ?? nav;
    rootNav.navigate?.('Camera');
  };

  const goHomeWithoutSaving = () => {
    setShowExitConfirm(false);
    goToScan();
  };

  useFocusEffect(
    React.useCallback(() => {
      if (isReadOnly) return;

      if (unknownFood) {
        const onBack = () => {
          goToScan();
          return true;
        };
        const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
        return () => sub.remove();
      }

      const onBack = () => {
        requestExit();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [goToScan, isReadOnly, unknownFood])
  );

  const rawMacros = analysis.macros || {};
  const macros = unknownFood
    ? {
        ...rawMacros,
        calories: 0,
        carbs_g: 0,
        protein_g: 0,
        fat_g: 0,
        sugar_g: 0,
        fiber_g: 0,
        sodium_mg: 0,
      }
    : rawMacros;
  const proteinG = typeof macros.protein_g === 'number' ? macros.protein_g : Number(macros.protein_g ?? 0) || 0;
  const carbsG = typeof macros.carbs_g === 'number' ? macros.carbs_g : Number(macros.carbs_g ?? 0) || 0;
  const fatG = typeof macros.fat_g === 'number' ? macros.fat_g : Number(macros.fat_g ?? 0) || 0;
  const sugarG = typeof macros.sugar_g === 'number' ? macros.sugar_g : Number(macros.sugar_g ?? NaN);
  const fiberG = typeof macros.fiber_g === 'number' ? macros.fiber_g : Number(macros.fiber_g ?? NaN);
  const sodiumMg = typeof macros.sodium_mg === 'number' ? macros.sodium_mg : Number(macros.sodium_mg ?? NaN);

  const proteinKcal = Math.max(0, proteinG) * 4;
  const carbsKcal = Math.max(0, carbsG) * 4;
  const fatKcal = Math.max(0, fatG) * 9;
  const macroKcalSum = proteinKcal + carbsKcal + fatKcal;

  const macroPct = useMemo(() => {
    if (!(macroKcalSum > 0)) return { protein: 0, carbs: 0, fat: 0 };

    const p = Math.round((proteinKcal / macroKcalSum) * 100);
    const c = Math.round((carbsKcal / macroKcalSum) * 100);
    let f = 100 - p - c;
    if (f < 0) f = 0;
    if (p + c + f !== 100) {
      const delta = 100 - (p + c + f);
      f = Math.max(0, f + delta);
    }
    return { protein: p, carbs: c, fat: f };
  }, [carbsKcal, macroKcalSum, proteinKcal]);

  const userDisplayName = (profile?.nickname || profile?.name || '사용자').trim();

  const gradeColor = (ua?.grade && (GRADE_COLORS as any)[ua.grade]) ? (GRADE_COLORS as any)[ua.grade] : colors.primary;
  const scoreText = typeof score100 === 'number' ? `${score100}점` : null;

  const userAllergens = Array.isArray(profile?.allergens) ? profile!.allergens : [];
  const allergenHits = useMemo(() => computeAllergenHits(userAllergens, analysis), [analysis, userAllergens]);

  const checkLines = useMemo(() => {
    // 체크: "주의"처럼 아이콘+문장 (너무 길지 않게), '추정' 류 표현 금지
    const out: string[] = [];
    const push = (t: string) => {
      const v = String(t || '').trim();
      if (!v) return;
      if (out.includes(v)) return;
      out.push(v);
    };

    const dish = String(analysis?.dishName || '').trim();
    const tags = inlineTags;
    const has = (...keys: string[]) => {
      const needles = keys.filter(Boolean);
      if (needles.length === 0) return false;
      const hay = [dish, ...tags].join(' ').toLowerCase();
      return needles.some(k => hay.includes(String(k).toLowerCase()));
    };

    // Food-specific good points first (so it doesn't feel identical across foods)
    if (has('샐러드', '채소', '야채', '상추', '브로콜리', '시금치', '토마토', '오이')) {
      push('채소 비중이 있어 식이섬유 보강과 포만감 유지에 도움이 돼요.');
    } else if (has('연어', '고등어', '참치', '생선')) {
      push('생선류는 단백질과 오메가-3 섭취에 도움이 될 수 있어요(조리/소스는 확인).');
    } else if (has('닭가슴살', '닭고기', '치킨', '계란', '달걀')) {
      push('단백질 식품(닭/계란) 위주라 근육 유지와 포만감에 도움이 돼요.');
    } else if (has('두부', '콩', '대두')) {
      push('콩/두부는 식물성 단백질을 챙기기 좋은 선택이에요.');
    } else if (dish) {
      push(`${dish}는(은) 조리/소스에 따라 영양 밸런스가 크게 달라져요. 좋은 쪽으로 조절해볼 수 있어요.`);
    }

    // Protein
    if (proteinG >= 20) push('단백질이 충분한 편이라 포만감 유지와 근육 유지에 도움이 돼요.');
    else if (proteinG > 0 && proteinG < 15) push('단백질이 낮은 편이라 계란/두부/닭/생선 같은 단백질을 곁들이면 좋아요.');

    // Carbs/Fat balance
    if (macroPct.carbs > 55) push('탄수 비중이 높은 편이라 밥/면 양을 조금 줄이면 더 균형 잡히기 쉬워요.');
    if (macroPct.fat > 40) push('지방 비중이 높은 편이라 소스·기름을 줄이거나 담백한 조리를 선택하면 좋아요.');

    // Sodium
    if (Number.isFinite(sodiumMg) && sodiumMg > 800) push('나트륨이 높을 수 있어 국물/장류/가공 소스를 조심하는 게 좋아요.');
    else if (profile?.healthDiet === 'low_sodium') push('저염식 기준이라면 국물/소스는 적게, 찍어 먹는 방식이 좋아요.');

    // Fiber / sugar (if available)
    if (Number.isFinite(fiberG) && fiberG >= 6) push('식이섬유가 꽤 있는 편이라 혈당/포만감 관리에 도움이 돼요.');
    if (Number.isFinite(sugarG) && sugarG >= 15) push('당류가 높을 수 있어 음료/디저트/달달한 소스는 조절하면 좋아요.');

    // Goal/diet gentle hint
    if (profile?.bodyGoal === 'diet' && (macros.calories ?? 0) >= 700) push('다이어트 목표라면 오늘은 양을 1/2로 조절하면 부담이 줄어요.');
    if (profile?.healthDiet === 'low_carb' && macroPct.carbs > 45) push('저탄수 식단이라면 탄수(밥/면/빵) 비중을 조금 더 낮추면 좋아요.');
    if (profile?.healthDiet === 'high_protein' && proteinG < 25) push('고단백 식단이라면 단백질을 한 가지 더 보강하면 좋아요.');

    // Fallback
    if (out.length === 0) push('전체적으로 무난한 편이에요. 다음엔 더 선명하게 찍으면 조언이 더 구체적이에요.');

    return out.slice(0, 5);
  }, [analysis?.dishName, fiberG, inlineTags, macroPct.carbs, macroPct.fat, macros.calories, profile?.bodyGoal, profile?.healthDiet, proteinG, sodiumMg, sugarG]);

  const dangerItems = useMemo(() => {
    // 경고: 사용자에게 위험할 수 있는 것만(알레르기 등)
    const out: string[] = [];

    if (allergenHits.length > 0) {
      out.push(`알레르기 경고: ${allergenHits.join(', ')} 성분이 포함됐을 수 있어요. 섭취 전 원재료/성분표를 꼭 확인하세요.`);
    }

    if (profile?.healthDiet === 'diabetic') {
      const highCarb = carbsG > 60;
      const highSugar = Number.isFinite(sugarG) ? sugarG >= 15 : false;
      if (highCarb || highSugar) {
        out.push(
          `혈당 경고: ${highSugar ? '당류' : '탄수'}가 높을 수 있어요. 당뇨/혈당 관리 중이면 양을 줄이거나(1/2) 단백질·채소와 함께 드세요.`
        );
      }
    }

    return out;
  }, [allergenHits, carbsG, profile?.healthDiet, sugarG]);

  const cautionItems = useMemo(() => {
    // "주의"에는 경고(빨간 단계: 알레르기/혈당 등) 중복 표시를 넣지 않음
    const w = Array.isArray(warnings) ? warnings : [];
    return w.filter(t => {
      const s = String(t || '').trim();
      if (!s) return false;
      if (/알레르기|혈당|당뇨/i.test(s)) return false;
      if (/^\s*알레르기\s*주의/i.test(s)) return false;
      if (/^\s*알레르기\s*경고/i.test(s)) return false;
      if (/^\s*혈당\s*경고/i.test(s)) return false;
      return true;
    });
  }, [warnings]);

  const macroAdjustments = useMemo(() => {
    const out: string[] = [];
    if (!(macroKcalSum > 0)) return out;

    if (macroPct.protein < 20) out.push('단백질 비중이 낮은 편이에요. 단백질(닭/생선/두부/계란/그릭요거트)을 추가해보세요.');
    if (macroPct.protein > 45) out.push('단백질 비중이 높은 편이에요. 채소/수분/탄수 밸런스를 함께 챙기면 좋아요.');
    if (macroPct.carbs > 55) out.push('탄수화물 비중이 높은 편이에요. 면/밥 양을 줄이거나 통곡/채소로 대체해보세요.');
    if (macroPct.fat > 40) out.push('지방 비중이 높은 편이에요. 튀김/소스/기름진 부위를 줄이면 점수가 오르기 쉬워요.');

    if (profile?.healthDiet === 'low_carb' && macroPct.carbs > 45) out.push('저당식(저탄수) 식단이라면 탄수 비중을 더 낮추는 게 좋아요.');
    if (profile?.healthDiet === 'high_protein' && macroPct.protein < 25) out.push('고단백 식단이라면 단백질을 조금 더 보강하는 게 좋아요.');
    if (profile?.healthDiet === 'low_fat' && macroPct.fat > 35) out.push('저지방식이라면 지방(특히 튀김/가공)을 줄여보세요.');

    return out.slice(0, 6);
  }, [macroKcalSum, macroPct.carbs, macroPct.fat, macroPct.protein, profile?.healthDiet]);

  const dietSpecificWarningLine = useMemo(() => {
    // 주의 섹션에서만 최소한의 힌트로 사용(사용자별)
    switch (profile?.healthDiet) {
      case 'low_sodium': {
        const highSodium = Number.isFinite(sodiumMg) ? sodiumMg > 800 : false;
        return `${userDisplayName}님: 저염식 기준으로 나트륨이 ${highSodium ? '높을 수 있어요' : '확인해보세요'}.`;
      }
      case 'low_carb': {
        const highCarb = carbsG > 60;
        return `${userDisplayName}님: 저탄수 기준으로 탄수화물이 ${highCarb ? '많을 수 있어요' : '무난할 수 있어요'}.`;
      }
      case 'diabetic': {
        const highCarb = carbsG > 60;
        return `${userDisplayName}님: 혈당 관리라면 탄수/당(음료·소스)을 특히 확인하세요${highCarb ? ' (현재 탄수 비중이 높을 수 있어요)' : ''}.`;
      }
      case 'low_fat': {
        const highFat = fatG > 20;
        return `${userDisplayName}님: 저지방 기준으로 지방이 ${highFat ? '높을 수 있어요' : '무난할 수 있어요'}.`;
      }
      case 'high_protein': {
        const lowProtein = proteinG < 20;
        return `${userDisplayName}님: 고단백 기준으로 단백질이 ${lowProtein ? '부족할 수 있어요' : '괜찮을 수 있어요'}.`;
      }
      default:
        return null;
    }
  }, [carbsG, fatG, profile?.healthDiet, proteinG, sodiumMg, userDisplayName]);

  const renderList = (items: string[], variant: 'good' | 'bad' | 'warn') => {
    const iconName = variant === 'good' ? 'check-circle' : variant === 'bad' ? 'error' : 'warning';
    const color = variant === 'good' ? colors.success : variant === 'bad' ? colors.danger : colors.secondary;
    const textColor = variant === 'good' ? colors.success : variant === 'bad' ? colors.danger : colors.secondary;

    if (!items || items.length === 0) {
      const emptyText =
        variant === 'good'
          ? '현재 사진/정보만으로는 확실한 장점을 단정하기 어려워요. 더 선명하게 찍으면 좋아요.'
          : variant === 'bad'
            ? '뚜렷한 주의점은 발견되지 않았어요.'
            : '추가로 확인할 정보가 없어요.';

      return (
        <View style={styles.listBlock}>
          <View style={styles.listRow}>
            <AppIcon name={iconName as any} size={18} color={color} />
            <Text style={[styles.listRowText, { color: textColor, fontWeight: '700' }]}>{emptyText}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.listBlock}>
        {items.slice(0, 6).map((t, idx) => (
          <View key={`${variant}-${idx}`} style={styles.listRow}>
            <AppIcon name={iconName as any} size={18} color={color} />
            <Text style={[styles.listRowText, { color: textColor, fontWeight: '700' }]}>{t}</Text>
          </View>
        ))}
      </View>
    );
  };

  const Section = ({
    title,
    subtitle,
    children,
    noBorder = false,
  }: {
    title: string;
    subtitle?: string | null;
    children: React.ReactNode;
    noBorder?: boolean;
  }) => {
    return (
      <View style={[styles.section, { borderBottomColor: colors.border }, noBorder && styles.sectionNoBorder]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        </View>
        {subtitle ? <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
        {children}
      </View>
    );
  };

  const getMealTypeFromNow = (): 'breakfast' | 'lunch' | 'dinner' | 'snack' => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'breakfast';
    if (hour >= 11 && hour < 16) return 'lunch';
    if (hour >= 16 && hour < 22) return 'dinner';
    return 'snack';
  };

  const openSaveToCalendar = () => {
    const now = new Date();
    const ymd = toYmd(now);
    const mealType = getMealTypeFromNow();

    const baseCalories = unknownFood
      ? 0
      : (typeof (analysis as any)?.macros?.calories === 'number'
          ? (analysis as any).macros.calories
          : Number((analysis as any)?.macros?.calories ?? 0) || 0);
    const baseCarbs = unknownFood
      ? 0
      : (typeof (analysis as any)?.macros?.carbs_g === 'number'
          ? (analysis as any).macros.carbs_g
          : Number((analysis as any)?.macros?.carbs_g ?? 0) || 0);
    const baseProtein = unknownFood
      ? 0
      : (typeof (analysis as any)?.macros?.protein_g === 'number'
          ? (analysis as any).macros.protein_g
          : Number((analysis as any)?.macros?.protein_g ?? 0) || 0);
    const baseFat = unknownFood
      ? 0
      : (typeof (analysis as any)?.macros?.fat_g === 'number'
          ? (analysis as any).macros.fat_g
          : Number((analysis as any)?.macros?.fat_g ?? 0) || 0);

    const draft: ManualMealLog = {
      id: 'draft',
      userId: '',
      date: ymd,
      mealType,
      foodName: String(analysis?.dishName ?? '').trim() ? String(analysis.dishName).trim() : undefined,
      calories: Math.max(0, baseCalories),
      carbs_g: Math.max(0, baseCarbs),
      protein_g: Math.max(0, baseProtein),
      fat_g: Math.max(0, baseFat),
      imageUri,
      timestamp: now.toISOString(),
    };

    alert({
      title: '기록에 저장',
      message: ymd,
      actions: [],
      content: (
        <ManualLogEditor
          initial={draft}
          submitLabel="저장"
          onClose={dismiss}
          onSubmit={async (updates) => {
            try {
              const savedAt = new Date().toISOString();
              const imageBase64 = await fileUriToBase64(imageUri);
              const sessionUserId = await getSessionUserId().catch(() => null);
              if (!sessionUserId) throw new Error('로그인 상태에서만 캘린더에 저장할 수 있어요.');
              const remoteUserId = String(sessionUserId);

              // 1) 캘린더(해당 날짜 기록) 저장
              const newManual: ManualMealLog = {
                ...draft,
                ...updates,
                id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                userId: remoteUserId,
                date: ymd,
                imageBase64: imageBase64 ?? undefined,
                timestamp: savedAt,
              };
              await insertManualMealLogRemote({ ...newManual, userId: remoteUserId });
              const remoteLogs = await listManualMealLogsRemote(1000);
              await setManualMealLogs(remoteLogs);

              logEvent('calendar_log_saved', { source: isReadOnly ? 'history_result' : 'scan_result' });
              toast({ message: '캘린더에 추가했어요!', variant: 'success' });

              dismiss();
              (navigation as any).navigate('MainTab', { screen: 'Calendar' });
            } catch (e) {
              console.error('Failed to save food log', e);
              captureError(e, { screen: 'ResultScreen', action: 'save_food_log' });
              const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
              toast({ message: '저장에 실패했어요. 잠시 후 다시 시도해주세요.', variant: 'error', durationMs: 2400 });
              alert({
                title: '저장 실패',
                message: message || '기록 저장 중 오류가 발생했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.',
              });
            }
          }}
        />
      ),
    });
  };

  const handleSaveAndExit = () => {
    setShowExitConfirm(false);
    openSaveToCalendar();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Image */}
        <View style={styles.imageHeader} onLayout={onImageHeaderLayout}>
          <Image source={{ uri: imageUri }} style={styles.headerImage} />
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              if (isReadOnly) {
                navigation.goBack();
                return;
              }
              if (unknownFood) {
                goToScan();
                return;
              }
              requestExit();
            }}
          >
            <AppIcon name="chevron-left" size={26} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.previewButton} onPress={() => setIsImagePreviewOpen(true)}>
            <Text style={styles.previewButtonText}>{isReadOnly ? '기록 사진 보기' : '사진 자세히 보기'}</Text>
          </TouchableOpacity>

          {/* 이미지 위 라벨/태그는 표시하지 않음 (요청사항) */}
        </View>

        <View style={[styles.content, { backgroundColor: colors.background, borderTopColor: colors.border }] }>
          <Text style={[styles.foodName, { color: colors.text }]}>{analysis.dishName}</Text>
          {inlineTagsPreview.length > 0 ? (
            <View style={styles.inlineTagWrapRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.inlineTagRow}
              >
                {inlineTagsPreview.map((tag, idx) => (
                  <View
                    key={`inline-tag-${idx}`}
                    style={[
                      styles.inlineTagPill,
                      {
                        backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceElevated,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.inlineTagText, { color: colors.text }]} numberOfLines={1}>
                      {tag}
                    </Text>
                  </View>
                ))}

                {hasMoreInlineTags ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="더보기"
                    onPress={() => setShowTagsModal(true)}
                    style={[styles.inlineTagMorePill, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={[styles.inlineTagMoreText, { color: colors.text }]}>더보기</Text>
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
          <Text style={[styles.calories, { color: colors.text }]}>{macros.calories ?? '-'} kcal</Text>
          {scoreText ? (
            <View style={[styles.scoreInlinePill, { borderColor: gradeColor, backgroundColor: `${gradeColor}1A` }]}>
              <Text style={[styles.scoreInlineText, { color: gradeColor }]}>{scoreText}</Text>
            </View>
          ) : null}

          {unknownFood ? (
            <Section title="다시 촬영해보세요" noBorder>
              <Text style={[styles.analysisText, { color: colors.text }]}>음식이 잘 보이도록 선명하게 촬영해 주세요.</Text>
              <View style={[styles.listBlock, { marginTop: 8 }]}>
                <View style={styles.listRow}>
                  <AppIcon name="check" size={18} color={colors.textSecondary} />
                  <Text style={[styles.listRowText, { color: colors.text } ]}>초점을 맞추고 흔들림 없이 찍어주세요.</Text>
                </View>
                <View style={styles.listRow}>
                  <AppIcon name="check" size={18} color={colors.textSecondary} />
                  <Text style={[styles.listRowText, { color: colors.text } ]}>음식이 화면 중앙에 크게 나오게 해주세요.</Text>
                </View>
                <View style={styles.listRow}>
                  <AppIcon name="check" size={18} color={colors.textSecondary} />
                  <Text style={[styles.listRowText, { color: colors.text } ]}>조명이 어두우면 밝은 곳에서 다시 찍어주세요.</Text>
                </View>
              </View>
            </Section>
          ) : (
            <>
          {/* Macros + Diet Type */}
          <Section title="영양 요약">
            <View style={styles.macrosContainer}>
              <Card style={styles.macroCard}>
                <Text style={[styles.macroValue, { color: colors.text }]}>{proteinG || 0}g</Text>
                <Text style={[styles.macroLabel, { color: colors.textSecondary }]}>단백질</Text>
                <View style={[styles.macroBarTrack, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }] }>
                  <View style={[styles.macroBarFill, { backgroundColor: colors.primary, width: `${macroPct.protein}%` }]} />
                </View>
                <Text style={[styles.macroPctText, { color: colors.textSecondary }]}>{macroPct.protein}%</Text>
              </Card>
              <Card style={styles.macroCard}>
                <Text style={[styles.macroValue, { color: colors.text }]}>{carbsG || 0}g</Text>
                <Text style={[styles.macroLabel, { color: colors.textSecondary }]}>탄수화물</Text>
                <View style={[styles.macroBarTrack, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }] }>
                  <View style={[styles.macroBarFill, { backgroundColor: colors.secondary, width: `${macroPct.carbs}%` }]} />
                </View>
                <Text style={[styles.macroPctText, { color: colors.textSecondary }]}>{macroPct.carbs}%</Text>
              </Card>
              <Card style={styles.macroCard}>
                <Text style={[styles.macroValue, { color: colors.text }]}>{fatG || 0}g</Text>
                <Text style={[styles.macroLabel, { color: colors.textSecondary }]}>지방</Text>
                <View style={[styles.macroBarTrack, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }] }>
                  <View style={[styles.macroBarFill, { backgroundColor: colors.destructive, width: `${macroPct.fat}%` }]} />
                </View>
                <Text style={[styles.macroPctText, { color: colors.textSecondary }]}>{macroPct.fat}%</Text>
              </Card>
            </View>

            <View style={[styles.macroGauge, { marginTop: 10, backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
              <View style={[styles.macroGaugeSeg, { backgroundColor: colors.primary, width: `${macroPct.protein}%` }]} />
              <View style={[styles.macroGaugeSeg, { backgroundColor: colors.secondary, width: `${macroPct.carbs}%` }]} />
              <View style={[styles.macroGaugeSeg, { backgroundColor: colors.destructive, width: `${macroPct.fat}%` }]} />
            </View>

            <Text style={[styles.subTitle, { marginTop: 12, color: colors.text }]}>수정/추가 포인트</Text>
            {macroAdjustments.length > 0 ? (
              <View style={styles.listBlock}>
                {macroAdjustments.map((t, idx) => (
                  <View key={`adj-${idx}`} style={styles.listRow}>
                    <AppIcon name="tune" size={18} color={colors.textSecondary} />
                    <Text style={[styles.listRowText, { color: colors.text }]}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.listBlock}>
                <View style={styles.listRow}>
                  <AppIcon name="tune" size={18} color={colors.textSecondary} />
                  <Text style={[styles.listRowText, { color: colors.text }]}>현재는 큰 수정 포인트가 없어요. 사진을 더 선명하게 찍으면 조언이 더 구체화돼요.</Text>
                </View>
              </View>
            )}
          </Section>

          {/* Good */}
          <Section title="체크">
            <View style={styles.listBlock}>
              {checkLines.map((t, idx) => (
                <View key={`check-${idx}`} style={styles.listRow}>
                  <AppIcon name="check-circle" size={18} color={colors.success} />
                  <Text style={[styles.listRowText, { color: colors.success, fontWeight: '700' }]}>{t}</Text>
                </View>
              ))}
            </View>
          </Section>

          {/* Bad */}
          <Section title="경고">
            {dangerItems.length > 0 ? (
              <View style={styles.listBlock}>
                {dangerItems.map((t, idx) => (
                  <View key={`danger-${idx}`} style={styles.listRow}>
                    <AppIcon name="warning" size={18} color={colors.danger} />
                    <Text style={[styles.listRowText, { color: colors.danger, fontWeight: '700' }]}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.listBlock}>
                <View style={styles.listRow}>
                  <AppIcon name="check-circle" size={18} color={colors.textSecondary} />
                  <Text style={[styles.listRowText, { color: colors.text }]}>현재 프로필 기준으로 특별히 위험한 경고는 없어요.</Text>
                </View>
              </View>
            )}
          </Section>

          {/* Caution */}
          <Section title="주의" subtitle={dietSpecificWarningLine}>
            {renderList(cautionItems, 'warn')}
          </Section>

          {/* Alternatives */}
          <Section title="추천/대체" subtitle={tips.length > 1 ? '개선하면 점수가 오를 수 있어요.' : null}>
            {alternatives.length > 0 ? (
              <View style={styles.listBlock}>
                {alternatives.slice(0, 6).map((t: string, idx: number) => (
                  <View key={`alt-${idx}`} style={styles.listRow}>
                    <AppIcon name="swap-horiz" size={18} color={colors.textSecondary} />
                    <Text style={[styles.listRowText, { color: colors.text }]}>{t}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.listBlock}>
                <View style={styles.listRow}>
                  <AppIcon name="swap-horiz" size={18} color={colors.textSecondary} />
                  <Text style={[styles.listRowText, { color: colors.text }]}>채소를 곁들이고, 소스를 줄이면 더 좋은 선택이 될 수 있어요.</Text>
                </View>
              </View>
            )}
          </Section>

          {/* Other */}
          <Section title="분석 상세" subtitle="목표/식단/건강 관점에서 더 풀어쓴 내용">
              <>
                <Text style={[styles.subTitle, { color: colors.text }]}>목표 기준</Text>
                {goalFit.slice(0, 4).map((t: string, idx: number) => (
                  <Text key={`goal-${idx}`} style={[styles.bulletText, { color: colors.textSecondary }]}>• {t}</Text>
                ))}
              </>
              <>
                <Text style={[styles.subTitle, { marginTop: 10, color: colors.text }]}>현재 식단 기준</Text>
                {dietFit.slice(0, 4).map((t: string, idx: number) => (
                  <Text key={`diet-${idx}`} style={[styles.bulletText, { color: colors.textSecondary }]}>• {t}</Text>
                ))}
              </>
              <>
                <Text style={[styles.subTitle, { marginTop: 10, color: colors.text }]}>건강 관점</Text>
                {healthImpact.slice(0, 6).map((t: string, idx: number) => (
                  <Text key={`health-${idx}`} style={[styles.bulletText, { color: colors.textSecondary }]}>• {t}</Text>
                ))}
              </>
          </Section>

          {/* At a glance (bottom) */}
          <Section title="한눈에 보기" subtitle={tips[0] ? null : '분석이 비어있으면 기본 설명이 표시돼요.'} noBorder>
            <Text style={[styles.analysisText, { color: colors.text }] }>
              {tips[0] || analysis.description || '분석 결과가 없습니다.'}
            </Text>
            <Text style={[styles.analysisNote, { color: colors.textSecondary }]}>
              사진과 사용자 프로필을 바탕으로 AI가 추정한 결과예요. 더 정확히 보려면 선명하게 다시 찍어주세요.
            </Text>
          </Section>

            </>
          )}

          {isReadOnly ? (
            <Button 
              title="캘린더에 추가하기" 
              onPress={openSaveToCalendar} 
              icon={<AppIcon name="event-available" size={20} color="white" />}
              style={styles.doneButton}
            />
          ) : unknownFood ? (
            <Button
              title="다시 촬영하기"
              onPress={goToReshoot}
              icon={<AppIcon name="photo-camera" size={20} color="white" />}
              style={styles.doneButton}
            />
          ) : (
            <Button 
              title="캘린더에 추가하기" 
              onPress={openSaveToCalendar} 
              icon={<AppIcon name="event-available" size={20} color="white" />}
              style={styles.doneButton}
            />
          )}
        </View>
      </ScrollView>

      <Modal visible={isImagePreviewOpen} transparent animationType="fade" onRequestClose={() => setIsImagePreviewOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Image source={{ uri: imageUri }} style={styles.modalImage} resizeMode="contain" />
          <TouchableOpacity style={styles.modalCloseButton} onPress={() => setIsImagePreviewOpen(false)}>
            <AppIcon name="close" size={26} color="white" />
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={showTagsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTagsModal(false)}
      >
        <View style={styles.tagsBackdrop}>
          <View style={[styles.tagsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.tagsHeaderRow}>
              <Text style={[styles.tagsTitle, { color: colors.text }]}>재료/구성</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="닫기"
                onPress={() => setShowTagsModal(false)}
                style={[styles.tagsCloseBtn, { backgroundColor: colors.surfaceMuted }]}
              >
                <AppIcon name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.tagsGrid}>
              {inlineTags.map((tag, idx) => (
                <View key={`all-tag-${idx}`} style={[styles.tagsGridPill, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }] }>
                  <Text style={[styles.tagsGridText, { color: colors.text }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showExitConfirm} transparent animationType="fade" onRequestClose={() => setShowExitConfirm(false)}>
        <View style={styles.exitBackdrop}>
          <View style={[styles.exitCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.exitHeaderRow}>
              <Text style={[styles.exitTitle, { color: colors.text }]}>잠깐!</Text>
              <TouchableOpacity onPress={() => setShowExitConfirm(false)} style={[styles.exitCloseBtn, { backgroundColor: colors.surfaceMuted }]}>
                <AppIcon name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.exitMessage, { color: colors.textSecondary }]}>이 결과를 캘린더에 추가하고 나갈까요?</Text>

            <View style={styles.exitActionsRow}>
              <Button title="캘린더에 추가" onPress={handleSaveAndExit} style={styles.exitBtn} />
              <Button title="나가기" variant="outline" onPress={goHomeWithoutSaving} style={styles.exitBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  imageHeader: {
    width: '100%',
    height: 300,
    position: 'relative',
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewButton: {
    position: 'absolute',
    top: 22,
    right: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  previewButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    padding: 24,
    marginTop: -24,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
  },
  foodName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  inlineTagWrapRow: {
    marginBottom: 4,
  },
  inlineTagRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    paddingRight: 8,
    maxWidth: '100%',
  },
  inlineTagPill: {
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  inlineTagText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '800',
  },
  inlineTagMorePill: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  inlineTagMoreText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '900',
  },
  calories: {
    fontSize: 20,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  scoreInlinePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 24,
  },
  scoreInlineText: {
    fontSize: 14,
    fontWeight: '900',
  },
  allergenWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  allergenWarningText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '800',
  },

  exitBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  exitCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 16,
  },
  exitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exitTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
  },
  exitCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundGray,
  },
  exitMessage: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textSecondary,
  },
  exitActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  exitBtn: {
    flex: 1,
  },
  section: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionNoBorder: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
  },
  sectionSubtitle: {
    marginTop: 6,
    marginBottom: 10,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  checkBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  checkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  checkBadgeGood: {
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  checkBadgeTip: {
    backgroundColor: COLORS.backgroundGray,
    borderColor: COLORS.border,
  },
  checkBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.text,
  },
  checkBadgeTextGood: {
    color: COLORS.success,
  },
  checkBadgeTextTip: {
    color: COLORS.text,
  },
  macrosContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  macroCard: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
  },
  macroValue: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
    marginBottom: 4,
  },
  macroLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  macroBarTrack: {
    height: 6,
    borderRadius: 999,
    width: '100%',
    backgroundColor: COLORS.backgroundGray,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  macroBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  macroPctText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.textSecondary,
  },
  macroGauge: {
    height: 12,
    width: '100%',
    flexDirection: 'row',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundGray,
  },
  macroGaugeSeg: {
    height: '100%',
  },
  analysisText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    lineHeight: 24,
  },
  subTitle: {
    marginTop: 2,
    marginBottom: 6,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  bulletText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 4,
  },
  listBlock: {
    marginTop: 2,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  listRowText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  goodText: {
    color: COLORS.success,
    fontWeight: '700',
  },
  badText: {
    color: COLORS.danger,
    fontWeight: '700',
  },
  warnText: {
    color: COLORS.secondary,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: '800',
  },
  tagsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  tagsCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tagsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.text,
  },
  tagsCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundGray,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagsGridPill: {
    backgroundColor: COLORS.backgroundGray,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagsGridText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
  },
  analysisNote: {
    marginTop: 12,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  doneButton: {
    width: '100%',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 30,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
