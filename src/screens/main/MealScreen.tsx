import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  FlatList,
  Animated,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { AppIcon } from '../../components/ui/AppIcon';
import { useAppAlert } from '../../components/ui/AppAlert';
import { useUserStore } from '../../store/userStore';
import { consumeMonthlyMealPlanRemote, getMonthlyMealPlanCountRemote, getSessionUserId, insertMealPlanLogRemote, listMealPlanLogsRemote, listMonthlyUsedMealNamesRemote } from '../../services/userData';
import { generateMealPlanRemote } from '../../services/mealPlan';
import { retryAsync } from '../../services/retry';
import type { MealPlanDay, MealPlanResult, MealPlanMode } from '../../types/mealPlan';
import type { MealPlanLog } from '../../services/userData';
import { getPlanLimits } from '../../services/plans';
import { useTheme } from '../../theme/ThemeProvider';

export default function MealScreen() {
  const navigation = useNavigation<any>();
  const { alert } = useAppAlert();
  const { colors } = useTheme();

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const animateChipLayout = () => {
    LayoutAnimation.configureNext({
      duration: 180,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
  };

  const chipScaleMapRef = useRef<Map<string, Animated.Value>>(new Map());

  const getChipScale = (key: string) => {
    const map = chipScaleMapRef.current;
    const k = String(key || '').trim();
    if (!k) return new Animated.Value(1);
    const existing = map.get(k);
    if (existing) return existing;
    const created = new Animated.Value(1);
    map.set(k, created);
    return created;
  };

  const popChip = (key: string) => {
    const k = String(key || '').trim();
    if (!k) return;
    const v = chipScaleMapRef.current.get(k) ?? (() => {
      const created = new Animated.Value(1);
      chipScaleMapRef.current.set(k, created);
      return created;
    })();

    v.setValue(0.72);
    Animated.spring(v, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 160,
    }).start();
  };

  const shrinkAndRemoveChip = (key: string) => {
    const k = String(key || '').trim();
    if (!k) return;

    const v = getChipScale(k);
    Animated.timing(v, {
      toValue: 0.01,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      animateChipLayout();
      setSelectedPantryItems((prev) => prev.filter((x) => x !== k));
      chipScaleMapRef.current.delete(k);
      v.setValue(1);
    });
  };

  const clearAllPantryItems = () => {
    const items = [...selectedPantryItems];
    if (items.length === 0) return;

    Animated.parallel(
      items.map((k) =>
        Animated.timing(getChipScale(k), {
          toValue: 0.01,
          duration: 120,
          useNativeDriver: true,
        })
      )
    ).start(() => {
      animateChipLayout();
      chipScaleMapRef.current.clear();
      setSelectedPantryItems([]);
    });
  };

  const profile = useUserStore(state => state.profile);
  const monthlyMealPlanLimit = getPlanLimits(profile?.plan_id).monthlyMealPlanLimit;
  const isMaster =
    (profile as any)?.plan_id === 'master' ||
    profile?.username === 'master';

  const [usedMealPlanCount, setUsedMealPlanCount] = useState<number | null>(null);
  const [mode, setMode] = useState<MealPlanMode>('pantry');
  const [selectedPantryItems, setSelectedPantryItems] = useState<string[]>([]);
  const [isPantryPickerOpen, setIsPantryPickerOpen] = useState(false);
  const [pantrySearchText, setPantrySearchText] = useState('');
  const [customPantryText, setCustomPantryText] = useState('');
  const [result, setResult] = useState<MealPlanResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const inFlightRef = useRef(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [mealPlanLogs, setMealPlanLogs] = useState<MealPlanLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const reloadMealPlanLogs = async () => {
    const userId = await getSessionUserId().catch(() => null);
    if (!userId) {
      setMealPlanLogs([]);
      setIsLoadingLogs(false);
      return;
    }

    try {
      setIsLoadingLogs(true);
      const logs = await retryAsync(() => listMealPlanLogsRemote(10), { retries: 1, delayMs: 700 });
      setMealPlanLogs(logs);
    } catch {
      // keep current logs on transient failure
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const userId = await getSessionUserId().catch(() => null);
      if (!mounted) return;
      setIsLoggedIn(Boolean(userId));

      // Load monthly quota usage (logged-in only)
      if (userId) {
        try {
          const used = await retryAsync(() => getMonthlyMealPlanCountRemote(), { retries: 1, delayMs: 700 }).catch(() => null);
          if (mounted && typeof used === 'number') setUsedMealPlanCount(used);
        } catch {
          // keep current count on transient failure
        }
      } else {
        setUsedMealPlanCount(null);
      }

      // Load history
      if (mounted) await reloadMealPlanLogs();
    })();

    return () => {
      mounted = false;
    };
  }, [profile?.id]);

  useFocusEffect(
    React.useCallback(() => {
      void reloadMealPlanLogs();
    }, [profile?.id])
  );

  const remainingMealPlanThisMonth =
    typeof usedMealPlanCount === 'number' ? Math.max(0, monthlyMealPlanLimit - usedMealPlanCount) : null;

  const displayName = String(profile?.nickname || (profile as any)?.name || profile?.username || '사용자');

  const sanitizePantrySelection = (items: string[]) => {
    const normalize = (raw: string) =>
      raw
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[\t\r]/g, ' ')
        .replace(/[\s]+/g, ' ')
        .replace(/^[\s\-–—•·,.;:|/\\]+/, '')
        .replace(/[\s\-–—•·,.;:|/\\]+$/, '')
        .trim();

    const isAllowedFoodInput = (s: string) => {
      if (!s) return false;
      if (s.length < 1 || s.length > 40) return false;
      if (!/[A-Za-z가-힣]/.test(s)) return false;

      // Avoid overly noisy strings
      const specialCount = (s.match(/[^0-9A-Za-z가-힣\s]/g) || []).length;
      if (specialCount >= 6) return false;

      const t = s.toLowerCase();
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
      if (blocked.some((re) => re.test(t))) return false;

      return true;
    };

    const cleaned = (Array.isArray(items) ? items : [])
      .map((x) => normalize(String(x ?? '')))
      .filter(Boolean)
      .filter(isAllowedFoodInput);

    // Selection is limited to 20 items.
    return Array.from(new Set(cleaned)).slice(0, 20);
  };

  const normalizeSearchKey = (v: string) =>
    String(v || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[()\[\]{}'"`]/g, '')
      .trim();

  type PantryCatalogItem = {
    name: string;
    keywords: string[];
  };

  const PANTRY_CATALOG: PantryCatalogItem[] = useMemo(
    () => {
      const mk = (name: string, keywords: string[] = []) => ({
        name,
        keywords: Array.from(new Set([name, ...keywords])).filter(Boolean),
      });

      return [
        // 단백질
        mk('닭가슴살', ['chicken breast', 'chicken', 'poultry']),
        mk('닭다리살', ['chicken thigh', 'chicken']),
        mk('계란', ['egg', 'eggs']),
        mk('두부', ['tofu']),
        mk('소고기 우둔살', ['beef', 'beef round', 'lean beef']),
        mk('소고기 등심', ['beef sirloin', 'sirloin']),
        mk('돼지등심', ['pork loin', 'pork']),
        mk('돼지안심', ['pork tenderloin', 'pork']),
        mk('연어', ['salmon']),
        mk('참치', ['tuna']),
        mk('새우', ['shrimp', 'prawn']),
        mk('오징어', ['squid']),
        mk('고등어', ['mackerel']),
        mk('대구', ['cod']),
        mk('전어', ['fish']),
        mk('콩', ['beans']),
        mk('병아리콩', ['chickpea', 'chickpeas', 'garbanzo']),
        mk('렌틸콩', ['lentil', 'lentils']),
        mk('검은콩', ['black beans', 'beans']),
        mk('그릭요거트', ['greek yogurt', 'yogurt']),
        mk('요거트', ['yogurt']),
        mk('우유', ['milk']),
        mk('저지방 우유', ['low fat milk', 'milk']),
        mk('치즈', ['cheese']),
        mk('코티지치즈', ['cottage cheese']),
        mk('프로틴 파우더', ['protein powder', 'whey', 'whey protein']),

        // 탄수화물/곡물
        mk('현미', ['brown rice']),
        mk('백미', ['white rice', 'rice']),
        mk('귀리', ['oats']),
        mk('오트밀', ['oatmeal', 'oats']),
        mk('고구마', ['sweet potato']),
        mk('감자', ['potato']),
        mk('바나나', ['banana']),
        mk('통밀빵', ['whole wheat bread', 'bread']),
        mk('식빵', ['bread']),
        mk('또띠아', ['tortilla']),
        mk('파스타', ['pasta']),
        mk('통밀 파스타', ['whole wheat pasta', 'pasta']),
        mk('소면', ['noodles', 'thin noodles']),
        mk('우동면', ['udon', 'noodles']),
        mk('라면', ['ramen']),
        mk('라이스페이퍼', ['rice paper']),
        mk('떡', ['rice cake', 'tteok']),
        mk('옥수수', ['corn']),

        // 채소
        mk('브로콜리', ['broccoli']),
        mk('양배추', ['cabbage']),
        mk('상추', ['lettuce']),
        mk('깻잎', ['perilla leaf', 'perilla']),
        mk('시금치', ['spinach']),
        mk('케일', ['kale']),
        mk('토마토', ['tomato', 'tomatoes']),
        mk('방울토마토', ['cherry tomato', 'tomato']),
        mk('오이', ['cucumber']),
        mk('양파', ['onion']),
        mk('대파', ['green onion', 'scallion']),
        mk('쪽파', ['green onion', 'scallion']),
        mk('마늘', ['garlic']),
        mk('버섯', ['mushroom', 'mushrooms']),
        mk('새송이버섯', ['mushroom']),
        mk('표고버섯', ['shiitake', 'mushroom']),
        mk('파프리카', ['bell pepper', 'pepper']),
        mk('당근', ['carrot']),
        mk('애호박', ['zucchini']),
        mk('가지', ['eggplant']),
        mk('콩나물', ['bean sprouts']),
        mk('숙주', ['mung bean sprouts', 'bean sprouts']),
        mk('김치', ['kimchi']),
        mk('해조류(미역/김)', ['seaweed', 'wakame', 'gim']),
        mk('미역', ['seaweed', 'wakame']),
        mk('김', ['seaweed', 'gim', 'nori']),
        mk('샐러드 믹스', ['salad', 'salad mix']),

        // 과일
        mk('사과', ['apple']),
        mk('딸기', ['strawberry', 'strawberries']),
        mk('블루베리', ['blueberry', 'blueberries']),
        mk('오렌지', ['orange']),
        mk('키위', ['kiwi']),
        mk('포도', ['grape', 'grapes']),
        mk('레몬', ['lemon']),

        // 견과/지방
        mk('아몬드', ['almond', 'almonds']),
        mk('호두', ['walnut', 'walnuts']),
        mk('캐슈넛', ['cashew', 'cashews']),
        mk('땅콩버터', ['peanut butter']),
        mk('올리브오일', ['olive oil']),
        mk('참기름', ['sesame oil']),
        mk('아보카도', ['avocado']),
        mk('버터', ['butter']),

        // 기본 양념/소스
        mk('간장', ['soy sauce']),
        mk('고추장', ['gochujang']),
        mk('된장', ['doenjang', 'soybean paste']),
        mk('소금', ['salt']),
        mk('후추', ['pepper']),
        mk('식초', ['vinegar']),
        mk('레몬즙', ['lemon juice']),
        mk('마요네즈', ['mayonnaise', 'mayo']),
        mk('케첩', ['ketchup']),
        mk('머스타드', ['mustard']),
        mk('스리라차', ['sriracha']),
        mk('고춧가루', ['chili powder']),
      ];
    },
    []
  );

  const filteredCatalog = useMemo(() => {
    const q = normalizeSearchKey(pantrySearchText);
    if (!q) return PANTRY_CATALOG;
    return PANTRY_CATALOG.filter((item) => {
      const keys = Array.isArray(item.keywords) ? item.keywords : [item.name];
      return keys.some((k) => normalizeSearchKey(k).includes(q));
    });
  }, [PANTRY_CATALOG, pantrySearchText]);

  const showManualAdd = useMemo(() => {
    const q = normalizeSearchKey(pantrySearchText);
    if (!q) return false;
    return filteredCatalog.length === 0;
  }, [filteredCatalog.length, pantrySearchText]);

  const customAddCandidate = useMemo(() => {
    const raw = String(pantrySearchText || '').trim();
    if (!raw) return null;
    const cleaned = sanitizePantrySelection([raw])[0];
    if (!cleaned) return null;
    if (selectedPantryItems.includes(cleaned)) return null;
    const existsInCatalog = PANTRY_CATALOG.some((c) => c.name === cleaned);
    // Even if it exists in catalog, allow quick-add.
    return { name: cleaned, existsInCatalog };
  }, [PANTRY_CATALOG, pantrySearchText, sanitizePantrySelection, selectedPantryItems]);

  const togglePantryItem = (item: string) => {
    const key = String(item || '').trim();
    if (!key) return;

    if (selectedPantryItems.includes(key)) {
      shrinkAndRemoveChip(key);
      return;
    }

    animateChipLayout();

    setSelectedPantryItems((prev) => {
      if (prev.length >= 20) {
        alert({ title: '최대 20개까지 선택 가능', message: '보유 음식은 최대 20개까지 선택할 수 있어요.' });
        return prev;
      }

      popChip(key);
      return [...prev, key];
    });
  };

  const addCustomPantryItem = (raw: string) => {
    const cleaned = sanitizePantrySelection([raw])[0];
    if (!cleaned) {
      alert({ title: '추가할 수 없는 항목', message: '음식/식재료 이름만 입력해 주세요.' });
      return;
    }

    animateChipLayout();

    setSelectedPantryItems((prev) => {
      if (prev.includes(cleaned)) return prev;
      if (prev.length >= 20) {
        alert({ title: '최대 20개까지 선택 가능', message: '보유 음식은 최대 20개까지 선택할 수 있어요.' });
        return prev;
      }

      popChip(cleaned);
      return [...prev, cleaned];
    });

    setCustomPantryText('');
  };

  const ensureMealPlanQuotaOrAlert = async () => {
    const userId = await getSessionUserId().catch(() => null);
    if (!userId) {
      setIsLoggedIn(false);
      alert({
        title: '로그인 필요',
        message: '식단 기록은 서버에만 저장돼요. 네트워크 연결을 확인한 뒤 로그인 후 다시 시도해주세요.',
      });
      return false;
    }
    try {
      setIsLoggedIn(true);
      const used = await getMonthlyMealPlanCountRemote();
      if (typeof used === 'number') {
        setUsedMealPlanCount(used);
        if (used >= monthlyMealPlanLimit) {
          alert({
            title: '식단 생성 기회 소진',
            message: `이번 달 식단 생성 기회를 모두 사용했어요. (${monthlyMealPlanLimit}회/월)`,
          });
          return false;
        }
      }
    } catch {
      // 조회 실패 시 보수적으로 막지 않음
    }
    return true;
  };

  const consumeMealPlanOrThrow = async () => {
    const userId = await getSessionUserId().catch(() => null);
    if (!userId) return;
    await consumeMonthlyMealPlanRemote(monthlyMealPlanLimit);
    try {
      const used = await getMonthlyMealPlanCountRemote().catch(() => null);
      if (typeof used === 'number') setUsedMealPlanCount(used);
    } catch {
      // ignore
    }
  };

  const normalizeMealPlan = (input: any): MealPlanResult | null => {
    if (!input || typeof input !== 'object') return null;
    const mode = String(input.mode || 'general') as MealPlanMode;
    const days = (Number(input.days) as any) || 1;
    const plan = Array.isArray(input.plan) ? input.plan : [];
    return {
      mode: mode === 'pantry' ? 'pantry' : 'general',
      days: days === 2 ? 2 : days === 3 ? 3 : 1,
      plan: plan as MealPlanDay[],
      notes: Array.isArray(input.notes) ? input.notes.map((x: any) => String(x)) : undefined,
    };
  };

  const handleGenerate = async (nextMode: MealPlanMode) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsGenerating(true);
    setMode(nextMode);
    setResult(null);

    try {
      const ok = await ensureMealPlanQuotaOrAlert();
      if (!ok) return;

      const pantryItems = nextMode === 'pantry' ? sanitizePantrySelection(selectedPantryItems) : [];
      if (nextMode === 'pantry' && pantryItems.length === 0) {
        alert({ title: '내 음식을 선택해주세요', message: '"내 음식 넣기"에서 보유 음식/식재료를 선택해 주세요. (최대 20개)' });
        setIsPantryPickerOpen(true);
        return;
      }

      // Build monthly "avoid foods" list so menus don't repeat within the month.
      let avoidFoods: string[] = [];
      try {
        avoidFoods = await listMonthlyUsedMealNamesRemote();
      } catch {
        avoidFoods = [];
      }

      // Consume quota at generation start (after validation)
      await consumeMealPlanOrThrow();

      const payload = {
        mode: nextMode,
        days: 1 as 1,
        pantryItems,
        userContext: {
          bodyGoal: profile?.bodyGoal,
          healthDiet: profile?.healthDiet,
          lifestyleDiet: profile?.lifestyleDiet,
          allergens: profile?.allergens,
        },
        avoidFoods,
        nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      };

      const res = await generateMealPlanRemote(payload as any);
      if (!res.ok) {
        alert({ title: '식단 생성 실패', message: res.message || '식단 생성 중 문제가 발생했습니다.' });
        return;
      }

      const normalized = normalizeMealPlan((res as any).data);
      if (!normalized) {
        alert({ title: '식단 생성 실패', message: '응답 형식이 올바르지 않습니다.' });
        return;
      }

      setResult(normalized);

      // Save as history (best-effort)
      try {
        await insertMealPlanLogRemote({
          mode: nextMode,
          pantryItems: nextMode === 'pantry' ? pantryItems : [],
          result: normalized,
        });
        const logs = await listMealPlanLogsRemote(10).catch(() => null);
        if (Array.isArray(logs)) setMealPlanLogs(logs);
      } catch {
        // ignore
      }
    } catch (e: any) {
      const msg = String(e?.message || e || 'UNKNOWN_ERROR');
      alert({ title: '오류', message: msg });
    } finally {
      setIsGenerating(false);
      inFlightRef.current = false;
    }
  };

  const renderMealRow = (label: string, meal: any) => {
    if (!meal) return null;
    const name = String(meal?.name || '').trim();
    const grams = Number(meal?.grams);
    const macros = meal?.macros || {};
    const cal = Number(macros?.calories);
    const carbs = Number(macros?.carbs_g);
    const protein = Number(macros?.protein_g);
    const fat = Number(macros?.fat_g);
    return (
      <View style={styles.mealRow}>
        <Text style={styles.mealLabel}>{label}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.mealName} numberOfLines={2}>{name || '-'}</Text>
          <Text style={styles.mealMeta}>
            {Number.isFinite(grams) ? `${Math.round(grams)}g` : '-'} · {Number.isFinite(cal) ? `${Math.round(cal)} kcal` : '-'}
            {'  '}| 탄 {Number.isFinite(carbs) ? Math.round(carbs) : '-'}g · 단 {Number.isFinite(protein) ? Math.round(protein) : '-'}g · 지 {Number.isFinite(fat) ? Math.round(fat) : '-'}g
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>AI 식단</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>목표/식단/알레르기를 반영해 식단을 짜드려요</Text>

        {/* Main Action Card */}
        <Card style={styles.actionCard} variant="elevated">
          <View style={styles.quotaRow}>
            <View style={[styles.iconCircle, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}>
              <AppIcon name="restaurant" size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>식단 생성</Text>
              <Text style={[styles.cardDescription, { color: colors.textSecondary }]}>현재 플랜은 월 {monthlyMealPlanLimit}회까지 식단 생성이 가능해요.</Text>
            </View>
            <Badge
              variant="outline"
              text={
                typeof remainingMealPlanThisMonth === 'number'
                  ? `남은 ${remainingMealPlanThisMonth}회`
                  : isLoggedIn
                    ? '조회 중'
                    : '로그인 필요'
              }
            />
          </View>

          <View style={{ height: 14 }} />

          <View style={styles.modeRow}>
            <TouchableOpacity
              onPress={() => setMode('general')}
              style={[styles.modeChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }, mode === 'general' && styles.modeChipActive, mode === 'general' && { backgroundColor: colors.surfaceMuted, borderColor: colors.primary }]}
            >
              <Text style={[styles.modeChipText, { color: colors.textSecondary }, mode === 'general' && styles.modeChipTextActive, mode === 'general' && { color: colors.primary }]}>하루 식단</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('pantry')}
              style={[styles.modeChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }, mode === 'pantry' && styles.modeChipActive, mode === 'pantry' && { backgroundColor: colors.surfaceMuted, borderColor: colors.primary }]}
            >
              <Text style={[styles.modeChipText, { color: colors.textSecondary }, mode === 'pantry' && styles.modeChipTextActive, mode === 'pantry' && { color: colors.primary }]}>보유음식기반</Text>
            </TouchableOpacity>
          </View>

          {mode === 'pantry' ? (
            <>
              <Button
                title="음식 추가"
                onPress={() => setIsPantryPickerOpen(true)}
                style={styles.pantryPickButton}
                icon={<AppIcon name="add" size={20} color="white" />}
              />

              <View style={styles.pantryMetaRow}>
                <View style={styles.pantryMetaCenterAbs}>
                  <View style={styles.pantryMetaCenterWrap}>
                    <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>내 음식</Text>
                    <Badge variant="outline" text={`${selectedPantryItems.length}/20`} />
                  </View>
                </View>

                <View style={styles.pantryMetaRightAbs}>
                  {selectedPantryItems.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => {
                        animateChipLayout();
                        clearAllPantryItems();
                      }}
                      activeOpacity={0.85}
                      style={styles.clearAllChip}
                    >
                      <Text style={styles.clearAllText}>전체 삭제</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {selectedPantryItems.length > 0 ? (
                <View style={styles.selectedChipsWrap}>
                  {selectedPantryItems.map((item) => (
                    <Animated.View
                      key={`pantry-${item}`}
                      style={{ transform: [{ scale: getChipScale(item) }] }}
                    >
                      <TouchableOpacity
                        onPress={() => togglePantryItem(item)}
                        activeOpacity={0.85}
                        style={[styles.selectedChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}
                      >
                        <Text style={[styles.selectedChipText, { color: colors.text }]} numberOfLines={1}>{item}</Text>
                        <AppIcon name="close" size={16} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </Animated.View>
                  ))}
                </View>
              ) : (
                <Text style={styles.helperLine}>보유한 음식/식재료를 선택하면 그걸로 1일 식단을 만들어줘요.</Text>
              )}

              <Button
                title={isGenerating ? '생성 중…' : '보유음식기반 하루 식단 만들기'}
                onPress={() => handleGenerate('pantry')}
                style={styles.mainButton}
                icon={isGenerating ? <ActivityIndicator color="white" /> : undefined}
              />
            </>
          ) : (
            <>
              <Text style={styles.helperLine}>보유 음식이 없어도 1일 식단을 바로 추천해요.</Text>
              <Button
                title={isGenerating ? '생성 중…' : '하루 식단 만들기'}
                onPress={() => handleGenerate('general')}
                style={styles.mainButton}
                icon={isGenerating ? <ActivityIndicator color="white" /> : undefined}
              />
            </>
          )}
        </Card>

        {/* Pantry picker modal */}
        <Modal
          visible={isPantryPickerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setIsPantryPickerOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.surfaceMuted }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>내 음식 선택</Text>
                <TouchableOpacity onPress={() => setIsPantryPickerOpen(false)} style={styles.modalCloseButton}>
                  <AppIcon name="close" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={[styles.searchRow, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated }]}>
                <AppIcon name="search" size={20} color={colors.textSecondary} />
                <TextInput
                  value={pantrySearchText}
                  onChangeText={setPantrySearchText}
                  placeholder="검색 (예: 닭, 두부, 브로콜리)"
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {pantrySearchText.trim() ? (
                  <TouchableOpacity onPress={() => setPantrySearchText('')}>
                    <AppIcon name="close" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {selectedPantryItems.length > 0 ? (
                <View style={styles.searchBelowRightRow}>
                  <TouchableOpacity
                    onPress={() => {
                      animateChipLayout();
                      clearAllPantryItems();
                    }}
                    activeOpacity={0.85}
                    style={[styles.clearAllChip, styles.searchBelowClearAllChip]}
                  >
                    <Text style={styles.clearAllText}>전체 삭제</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {selectedPantryItems.length > 0 ? (
                <View style={styles.selectedChipsWrap}>
                  {selectedPantryItems.map((item) => (
                    <Animated.View
                      key={`pantry-modal-${item}`}
                      style={{ transform: [{ scale: getChipScale(item) }] }}
                    >
                      <TouchableOpacity
                        onPress={() => togglePantryItem(item)}
                        activeOpacity={0.85}
                        style={[styles.selectedChip, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}
                      >
                        <Text style={[styles.selectedChipText, { color: colors.text }]} numberOfLines={1}>{item}</Text>
                        <AppIcon name="close" size={16} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </Animated.View>
                  ))}
                </View>
              ) : null}

              <View style={styles.modalMetaRow}>
                <Text style={styles.modalMetaText}>최대 20개까지 선택할 수 있어요.</Text>
                <View style={styles.metaRightRow}>
                  <View style={styles.metaClearSlot}>
                    {null}
                  </View>
                  <Badge variant="outline" text={`${selectedPantryItems.length}/20`} />
                </View>
              </View>

              {showManualAdd && customAddCandidate ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    togglePantryItem(customAddCandidate.name);
                    setPantrySearchText('');
                  }}
                  style={[styles.customAddRow, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}
                >
                  <View style={styles.customAddRowLeft}>
                    <View style={[styles.customAddIcon, { backgroundColor: colors.surfaceMuted }] }>
                      <AppIcon name="add" size={18} color={colors.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.customAddTitle, { color: colors.text }]} numberOfLines={1}>{customAddCandidate.name}</Text>
                      <Text style={[styles.customAddDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                        {'목록에 없어도 직접 추가할 수 있어요'}
                      </Text>
                    </View>
                  </View>
                  <Badge variant="secondary" text="추가" />
                </TouchableOpacity>
              ) : null}

              <FlatList
                data={filteredCatalog}
                    keyExtractor={(item) => `catalog-${item.name}`}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                      const checked = selectedPantryItems.includes(item.name);
                  return (
                    <TouchableOpacity
                      activeOpacity={0.85}
                          onPress={() => togglePantryItem(item.name)}
                      style={[styles.catalogRow, { borderColor: colors.surfaceMuted, backgroundColor: colors.surface }]}
                    >
                      <View style={styles.catalogRowLeft}>
                        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                          {checked ? <AppIcon name="check" size={18} color="white" /> : null}
                        </View>
                            <Text style={[styles.catalogRowText, { color: colors.text }]}>{item.name}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyCatalog}>
                    <Text style={[styles.emptyCatalogTitle, { color: colors.text }]}>검색 결과가 없어요</Text>
                    <Text style={[styles.emptyCatalogDesc, { color: colors.textSecondary }]}>
                      {showManualAdd ? '아래에서 직접 추가할 수 있어요.' : '다른 키워드로 검색해보세요.'}
                    </Text>
                  </View>
                }
                ListFooterComponent={showManualAdd ? (
                  <View style={styles.customInputSection}>
                    <Text style={[styles.customInputTitle, { color: colors.text }]}>
                      {displayName}님이 가지고 있는 음식이 없나요? 직접 추가해 보세요!
                    </Text>
                    <View style={styles.customInputRow}>
                      <TextInput
                        value={customPantryText}
                        onChangeText={setCustomPantryText}
                        placeholder="예: 퀴노아, 렌틸파스타, 코티지치즈"
                        placeholderTextColor={colors.textSecondary}
                        style={[styles.customInput, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          if (customPantryText.trim()) addCustomPantryItem(customPantryText);
                        }}
                      />
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => addCustomPantryItem(customPantryText)}
                        style={[styles.customAddButton, { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted }]}
                      >
                        <Text style={[styles.customAddButtonText, { color: colors.text }]}>추가</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.customInputHint, { color: colors.textSecondary }]}>
                      선택+직접추가 합쳐서 최대 20개까지 가능
                    </Text>
                  </View>
                ) : null}
              />

              <View style={styles.modalFooter}>
                <Button title="완료" onPress={() => setIsPantryPickerOpen(false)} style={styles.modalDoneButton} />
              </View>
            </View>
          </View>
        </Modal>

        {result ? (
          <Card style={styles.resultCard} variant="elevated">
            <View style={styles.resultHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>생성된 식단</Text>
              <Badge variant="secondary" text={result.mode === 'pantry' ? '보유음식기반' : '하루 식단'} />
            </View>

            {Array.isArray(result.notes) && result.notes.length > 0 ? (
              <Text style={[styles.resultNote, { color: colors.textSecondary }]}>{result.notes[0]}</Text>
            ) : null}

            {result.plan.map((d: any) => (
              <View key={`day-${d.day}`} style={[styles.dayBlock, { borderBottomColor: colors.border }]}>
                <Text style={[styles.dayTitle, { color: colors.text }]}>Day {d.day}</Text>
                {renderMealRow('아침', d?.meals?.breakfast)}
                {renderMealRow('점심', d?.meals?.lunch)}
                {renderMealRow('저녁', d?.meals?.dinner)}

                <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.totalLabel, { color: colors.text }]}>하루 총합</Text>
                  <Text style={[styles.totalValue, { color: colors.textSecondary }]}>
                    {Math.round(Number(d?.totals?.calories || 0))} kcal · 탄 {Math.round(Number(d?.totals?.carbs_g || 0))}g · 단 {Math.round(Number(d?.totals?.protein_g || 0))}g · 지 {Math.round(Number(d?.totals?.fat_g || 0))}g
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Meal plan history */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>최근 만든 식단</Text>
            <View />
          </View>

          {isLoadingLogs ? (
            <Card style={styles.emptyCard} variant="elevated">
              <Text style={[styles.emptyTitle, { color: colors.text }]}>불러오는 중…</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>잠시만 기다려주세요.</Text>
            </Card>
          ) : mealPlanLogs.length === 0 ? (
            <Card style={styles.emptyCard} variant="elevated">
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 기록이 없어요</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>식단을 만들면 자동으로 기록에 저장돼요.</Text>
            </Card>
          ) : (
            mealPlanLogs.map((log) => {
              const label = log.mode === 'pantry' ? '보유음식기반' : '하루 식단';
              const kcal = typeof log.previewKcal === 'number' ? log.previewKcal : 0;
              const title = String(log.previewTitle || '식단');
              const when = (() => {
                try {
                  return new Date(log.occurredAt).toLocaleString('ko-KR');
                } catch {
                  return String(log.occurredAt || '');
                }
              })();

              return (
                <TouchableOpacity
                  key={`mpl-${log.id}`}
                  style={[styles.historyItem, { backgroundColor: colors.surface, borderColor: colors.surfaceMuted }]}
                  onPress={() => navigation.navigate('MealPlanDetail', { id: log.id })}
                >
                  <View style={[styles.historyIcon, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}>
                    <AppIcon name="history" size={20} color={colors.textSecondary} />
                  </View>
                  <View style={styles.historyContent}>
                    <Text style={[styles.historyTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
                    <View style={styles.historyMeta}>
                      <AppIcon name="access-time" size={12} color={colors.textSecondary} />
                      <Text style={[styles.historyTime, { color: colors.textSecondary }]}>{when}</Text>
                      <Text style={[styles.dot, { color: colors.textSecondary }]}>•</Text>
                      <Text style={[styles.calories, { color: colors.textSecondary }]}>{kcal} kcal</Text>
                    </View>
                  </View>
                  <Badge variant="outline" text={label} />
                  <View style={{ marginLeft: 8, alignItems: 'flex-end' }}>
                    <Text style={[styles.detailHint, { color: colors.textSecondary }]}>자세히 보기</Text>
                    <AppIcon name="chevron-right" size={22} color={colors.textSecondary} />
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundGray,
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  header: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  modeChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.blue50,
  },
  modeChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  modeChipTextActive: {
    color: COLORS.primary,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  pantryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metaRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaClearSlot: {
    width: 86,
    alignItems: 'flex-end',
  },
  metaClearAllChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pantryPickButton: {
    marginBottom: 10,
  },
  pantryMetaRow: {
    position: 'relative',
    width: '100%',
    minHeight: 28,
    marginBottom: 10,
  },
  pantryMetaCenterAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pantryMetaCenterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pantryMetaRightAbs: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  selectedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    maxWidth: '100%',
    gap: 8,
    marginBottom: 12,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    maxWidth: '100%',
  },
  selectedChipText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '700',
    maxWidth: 150,
  },
  clearAllChip: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.destructive,
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    height: 110,
    color: COLORS.text,
    marginBottom: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    padding: 14,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.text,
  },
  modalCloseButton: {
    padding: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  searchBelowRightRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: -2,
    marginBottom: 8,
  },
  searchBelowClearAllChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    paddingVertical: 0,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  customAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.blue200,
    backgroundColor: COLORS.blue50,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
  },
  customAddRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 10,
  },
  customAddIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customAddTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: COLORS.text,
  },
  customAddDesc: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  modalMetaText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  catalogRow: {
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  catalogRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  catalogRowText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '700',
  },
  emptyCatalog: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyCatalogTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyCatalogDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  customInputSection: {
    paddingTop: 14,
    paddingBottom: 6,
  },
  customInputTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.text,
    marginBottom: 8,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 14,
  },
  customAddButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  customAddButtonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
  },
  customInputHint: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  modalFooter: {
    paddingTop: 10,
  },
  modalDoneButton: {
    width: '100%',
  },
  daysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  daysChips: {
    flexDirection: 'row',
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  dayChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.blue50,
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  dayChipTextActive: {
    color: COLORS.primary,
  },
  helperLine: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  resultCard: {
    marginTop: 12,
    padding: 14,
  },
  resultHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  resultNote: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 10,
    lineHeight: 16,
  },
  dayBlock: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
    marginTop: 12,
  },
  dayTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 10,
  },
  mealRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  mealLabel: {
    width: 36,
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  mealName: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 3,
  },
  mealMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundGray,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.text,
  },
  totalValue: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  actionCard: {
    alignItems: 'center',
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    backgroundColor: COLORS.blue50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  buttonGroup: {
    width: '100%',
    gap: 12,
  },
  mainButton: {
    width: '100%',
  },
  secondaryButton: {
    width: '100%',
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  seeAll: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: RADIUS.md,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  historyContent: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 4,
  },
  historyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  historyTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginLeft: 4,
  },
  dot: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginHorizontal: 6,
  },
  calories: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  detailHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
});
