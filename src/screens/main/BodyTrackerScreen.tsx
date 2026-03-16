import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AppIcon } from '../../components/ui/AppIcon';
import { useAppAlert } from '../../components/ui/AppAlert';
import { MAIN_SHORTCUT_BAR_HEIGHT, MainShortcutBar } from '../../components/ui/MainShortcutBar';
import { useUserStore } from '../../store/userStore';
import { chatHealth } from '../../services/api';
import {
  getMonthlyChatTokenStatusRemote,
  getSessionUserId,
  insertBodyLogRemote,
  listBodyLogsRemote,
  listFoodLogsRemote,
  updateBodyLogRemote,
} from '../../services/userData';
import { getPlanLimits } from '../../services/plans';
import { retryAsync } from '../../services/retry';
import { useTheme } from '../../theme/ThemeProvider';
import type { BodyLog, FoodLog } from '../../types/user';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toDayKey(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatShortDate(value: string) {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatMetric(value?: number, unit = 'kg') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return `${value.toFixed(1)}${unit}`;
}

function parseNumber(text: string) {
  const normalized = String(text || '').replace(/,/g, '.').trim();
  if (!normalized) return undefined;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function isOutOfWeightRange(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) && (value <= 0 || value > 500);
}

function sanitizeAiText(text: string) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function isBodyLogUpdatedAtSchemaError(error: unknown) {
  const text = String((error as any)?.message || error || '').toLowerCase();
  return text.includes('updated_at') && (text.includes('record "new"') || text.includes('field') || text.includes('body_logs'));
}

function buildWeightAnalysisPrompt(params: {
  bodyGoal?: string;
  currentWeight?: number;
  targetWeight?: number;
  healthDiet?: string;
  lifestyleDiet?: string;
  latestWeight?: number;
  latestMuscleMass?: number;
  latestBodyFat?: number;
  recentBodyLogs: BodyLog[];
  recentFoodLogs: FoodLog[];
}) {
  const recentBodyLines = params.recentBodyLogs
    .slice(0, 14)
    .map((log) => {
      const date = toDayKey(log.timestamp);
      return `${date}: 체중 ${log.weight}kg${typeof log.muscleMass === 'number' ? `, 골격근량 ${log.muscleMass}kg` : ''}${typeof log.bodyFat === 'number' ? `, 체지방량 ${log.bodyFat}kg` : ''}`;
    })
    .join('\n');

  const recentFoodLines = params.recentFoodLogs
    .slice(0, 12)
    .map((log) => {
      const kcal = typeof log.analysis?.macros?.calories === 'number' ? `${log.analysis.macros.calories}kcal` : 'kcal 정보 없음';
      const protein = typeof log.analysis?.macros?.protein_g === 'number' ? `${log.analysis.macros.protein_g}g` : '-';
      const carbs = typeof log.analysis?.macros?.carbs_g === 'number' ? `${log.analysis.macros.carbs_g}g` : '-';
      const fat = typeof log.analysis?.macros?.fat_g === 'number' ? `${log.analysis.macros.fat_g}g` : '-';
      return `${toDayKey(log.timestamp)} ${log.analysis?.dishName ?? '기록'} / ${kcal} / 단백질 ${protein}, 탄수 ${carbs}, 지방 ${fat}`;
    })
    .join('\n');

  return [
    '아래는 뉴핏 사용자의 최근 신체 기록과 식사 기록이야.',
    '이 정보만 보고 체중 감량/유지/벌크업 목표에 맞춘 매우 개인화된 분석을 해줘.',
    '식단 추천 기능이 아니라 분석 기능이므로, 현재 패턴을 읽고 어떤 음식을 늘리고 줄이면 좋은지 분석 위주로 답변해줘.',
    '의학적 진단처럼 말하지 말고, 생활 코치처럼 현실적으로 답해줘.',
    '답변은 반드시 자연스러운 한국어로만 작성해줘.',
    '영어 제목, 영어 문장, 마크다운 기호(**, __, #, `)는 절대 쓰지 마.',
    '',
    `사용자 목표: ${params.bodyGoal || '미설정'}`,
    `현재 체중(프로필): ${params.currentWeight ?? '-'}kg`,
    `목표 체중: ${params.targetWeight ?? '-'}kg`,
    `최근 입력 체중: ${params.latestWeight ?? '-'}kg`,
    `최근 골격근량: ${params.latestMuscleMass ?? '-'}kg`,
    `최근 체지방량: ${params.latestBodyFat ?? '-'}kg`,
    `건강 식단: ${params.healthDiet || '미설정'}`,
    `생활 식단: ${params.lifestyleDiet || '미설정'}`,
    '',
    '[최근 신체 기록]',
    recentBodyLines || '없음',
    '',
    '[최근 식사 기록]',
    recentFoodLines || '없음',
    '',
    '반드시 아래 형식으로 한국어로 답변해줘:',
    '1. 현재 상태 요약',
    '2. 왜 이런 흐름인지',
    '3. 지금 늘리면 좋은 음식',
    '4. 지금 줄이면 좋은 음식',
    '5. 내일 바로 실천할 3가지',
    '',
    '각 항목은 짧고 명확하게, 사용자가 바로 행동할 수 있게 작성해줘.',
  ].join('\n');
}

export default function BodyTrackerScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const { alert } = useAppAlert();

  const profile = useUserStore((state) => state.profile);
  const bodyLogs = useUserStore((state) => state.bodyLogs);
  const foodLogs = useUserStore((state) => state.foodLogs);
  const loadBodyLogs = useUserStore((state) => state.loadBodyLogs);
  const loadFoodLogs = useUserStore((state) => state.loadFoodLogs);
  const setBodyLogs = useUserStore((state) => state.setBodyLogs);
  const setFoodLogs = useUserStore((state) => state.setFoodLogs);
  const updateProfile = useUserStore((state) => state.updateProfile);

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [weightText, setWeightText] = useState('');
  const [muscleText, setMuscleText] = useState('');
  const [bodyFatText, setBodyFatText] = useState('');
  const [analysisText, setAnalysisText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<null | { remaining: number; limit: number; used: number; planId: string }>(null);

  const todayKey = useMemo(() => toDayKey(new Date()), []);
  const sortedBodyLogs = useMemo(
    () => [...(bodyLogs || [])].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')),
    [bodyLogs]
  );
  const latestBodyLog = sortedBodyLogs[0];
  const todayLog = useMemo(() => sortedBodyLogs.find((log) => toDayKey(log.timestamp) === todayKey), [sortedBodyLogs, todayKey]);

  const latestWeight = typeof latestBodyLog?.weight === 'number' ? latestBodyLog.weight : profile?.currentWeight;
  const targetWeight = profile?.targetWeight;
  const planLimits = getPlanLimits(profile?.plan_id);

  const resetToMainTab = useCallback(
    (screen: 'Scan' | 'Meal' | 'Calendar' | 'Profile') => {
      const parentNav = navigation.getParent?.();
      const rootNav = parentNav?.getParent?.() ?? parentNav ?? navigation;
      rootNav.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'MainTab', params: { screen } }],
        })
      );
    },
    [navigation]
  );

  const refreshRemoteTrackerData = useCallback(async (userId: string) => {
    const [remoteBody, remoteFood, chatToken] = await Promise.all([
      retryAsync(() => listBodyLogsRemote(90), { retries: 1, delayMs: 700 }).catch(() => null),
      retryAsync(() => listFoodLogsRemote(40), { retries: 1, delayMs: 700 }).catch(() => null),
      retryAsync(() => getMonthlyChatTokenStatusRemote(), { retries: 1, delayMs: 700 }).catch(() => null),
    ]);

    if (Array.isArray(remoteBody)) {
      await setBodyLogs(remoteBody);
    }
    if (Array.isArray(remoteFood)) {
      await setFoodLogs(remoteFood);
    }
    if (chatToken) {
      setTokenStatus({
        remaining: Number(chatToken.remaining || 0),
        limit: Number(chatToken.limit_value || 0),
        used: Number(chatToken.used || 0),
        planId: String(chatToken.plan_id || 'free'),
      });
    }

    return {
      hasBody: Array.isArray(remoteBody),
      hasFood: Array.isArray(remoteFood),
    };
  }, [setBodyLogs, setFoodLogs]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      void (async () => {
        const userId = await getSessionUserId().catch(() => null);
        if (!alive) return;
        setSessionUserId(userId);

        if (userId) {
          const firstLoad = await refreshRemoteTrackerData(userId).catch(() => null);
          if (!alive) return;

          if (!firstLoad?.hasBody || !firstLoad?.hasFood) {
            retryTimer = setTimeout(() => {
              if (!alive) return;
              void refreshRemoteTrackerData(userId).catch(() => {
                // ignore retry failure and keep current state
              });
            }, 900);
          }
          return;
        }

        await Promise.all([loadBodyLogs(), loadFoodLogs()]);
      })();

      return () => {
        alive = false;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }, [loadBodyLogs, loadFoodLogs, refreshRemoteTrackerData])
  );

  useEffect(() => {
    if (todayLog) {
      setWeightText(typeof todayLog.weight === 'number' ? String(todayLog.weight) : '');
      setMuscleText(typeof todayLog.muscleMass === 'number' ? String(todayLog.muscleMass) : '');
      setBodyFatText(typeof todayLog.bodyFat === 'number' ? String(todayLog.bodyFat) : '');
      return;
    }

    setWeightText(typeof profile?.currentWeight === 'number' ? String(profile.currentWeight) : '');
    setMuscleText('');
    setBodyFatText('');
  }, [profile?.currentWeight, todayLog]);

  const chartLogs = useMemo(() => {
    return [...sortedBodyLogs]
      .slice(0, 7)
      .reverse()
      .filter((log) => typeof log.weight === 'number' && Number.isFinite(log.weight));
  }, [sortedBodyLogs]);

  const chartWidth = Math.max(240, width - 84);
  const chartHeight = 180;
  const chartAxisLabelWidth = 34;
  const chartPaddingX = 12;
  const chartPaddingY = 18;

  const chartMeta = useMemo(() => {
    if (chartLogs.length === 0) return null;

    const values = chartLogs.map((log) => log.weight);
    const latestReferenceWeight = typeof latestWeight === 'number' && Number.isFinite(latestWeight) ? latestWeight : undefined;
    const targetReferenceWeight = typeof targetWeight === 'number' && Number.isFinite(targetWeight) ? targetWeight : undefined;

    const minValue = Math.min(
      ...values,
      ...(typeof targetReferenceWeight === 'number' ? [targetReferenceWeight - 3] : []),
      ...(typeof latestReferenceWeight === 'number' ? [latestReferenceWeight] : [])
    );
    const maxValue = Math.max(
      ...values,
      ...(typeof latestReferenceWeight === 'number' ? [latestReferenceWeight] : []),
      ...(typeof targetReferenceWeight === 'number' ? [targetReferenceWeight] : [])
    );

    const min = Math.floor(minValue);
    const max = Math.ceil(maxValue);
    const safeMax = max === min ? max + 1 : max;
    const plotStartX = chartAxisLabelWidth + chartPaddingX;
    const plotEndX = chartWidth - chartPaddingX;
    const plotHeight = chartHeight - chartPaddingY * 2;
    const toY = (weight: number) => {
      const ratio = (weight - min) / Math.max(safeMax - min, 0.0001);
      return chartHeight - chartPaddingY - ratio * plotHeight;
    };

    const yTicks = Array.from({ length: safeMax - min + 1 }, (_, index) => {
      const value = safeMax - index;
      return {
        value,
        y: toY(value),
      };
    });

    const points = chartLogs.map((log, index) => {
      const x = plotStartX + (index * (plotEndX - plotStartX)) / Math.max(chartLogs.length - 1, 1);
      const y = toY(log.weight);
      return { x, y, label: formatShortDate(log.timestamp), value: log.weight };
    });

    return {
      min,
      max,
      plotStartX,
      plotEndX,
      yTicks,
      points,
      latestReferenceY: typeof latestReferenceWeight === 'number' ? toY(latestReferenceWeight) : null,
      polyline: points.map((point) => `${point.x},${point.y}`).join(' '),
    };
  }, [chartAxisLabelWidth, chartHeight, chartLogs, chartPaddingX, chartPaddingY, chartWidth, latestWeight, targetWeight]);

  const handleSaveToday = async () => {
    const nextWeight = parseNumber(weightText);
    const nextMuscleMass = parseNumber(muscleText);
    const nextBodyFat = parseNumber(bodyFatText);

    if (typeof nextWeight !== 'number') {
      alert({ title: '체중 입력', message: '오늘 몸무게를 먼저 입력해주세요.' });
      return;
    }

    if (isOutOfWeightRange(nextWeight)) {
      alert({ title: '체중 입력', message: '몸무게는 0 ~ 500 사이 값으로 입력해주세요.' });
      return;
    }

    const now = new Date().toISOString();

    if (!sessionUserId) {
      alert({
        title: '로그인 필요',
        message: '몸무게 기록은 서버에만 저장돼요. 네트워크 연결을 확인한 뒤 로그인 후 다시 시도해주세요.',
      });
      return;
    }

    try {
      setIsSaving(true);

      try {
        await retryAsync(
          () =>
            todayLog
              ? updateBodyLogRemote(todayLog.id, {
                  weight: nextWeight,
                  muscleMass: nextMuscleMass,
                  bodyFat: nextBodyFat,
                  timestamp: now,
                })
              : insertBodyLogRemote({
                  userId: sessionUserId,
                  weight: nextWeight,
                  muscleMass: nextMuscleMass,
                  bodyFat: nextBodyFat,
                  timestamp: now,
                }),
          { retries: 1, delayMs: 700 }
        );
      } catch (e) {
        if (isBodyLogUpdatedAtSchemaError(e)) {
          throw new Error('서버 body_logs 설정이 아직 완전히 반영되지 않았어요. 잠시 후 다시 시도해주세요.');
        }
        throw e;
      }

      const refreshed = await refreshRemoteTrackerData(sessionUserId).catch(() => null);
      if (!refreshed?.hasBody) {
        const optimisticSaved: BodyLog = {
          id: todayLog?.id ?? `${Date.now()}`,
          userId: sessionUserId,
          weight: nextWeight,
          muscleMass: nextMuscleMass,
          bodyFat: nextBodyFat,
          timestamp: now,
        };
        const nextLogs = (() => {
          const others = sortedBodyLogs.filter((log) => log.id !== optimisticSaved.id && toDayKey(log.timestamp) !== todayKey);
          return [optimisticSaved, ...others].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        })();
        await setBodyLogs(nextLogs);
      }
      await updateProfile({ currentWeight: nextWeight });
      alert({ title: '저장 완료', message: todayLog ? '오늘 몸무게 기록을 수정했어요.' : '오늘 몸무게 기록을 저장했어요.' });
    } catch (e: any) {
      alert({ title: '저장 실패', message: String(e?.message || e || '기록 저장 중 오류가 발생했어요.') });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAnalyze = async () => {
    if (!sessionUserId) {
      alert({ title: '로그인 필요', message: 'AI 분석은 로그인 후 사용할 수 있어요.' });
      return;
    }

    if (typeof tokenStatus?.remaining === 'number' && tokenStatus.remaining <= 0) {
      alert({ title: '토큰 부족', message: '이번 달 챗봇 토큰을 모두 사용했어요.' });
      return;
    }

    try {
      setIsAnalyzing(true);
      const response = await chatHealth({
        message: buildWeightAnalysisPrompt({
          bodyGoal: profile?.bodyGoal,
          currentWeight: profile?.currentWeight,
          targetWeight: profile?.targetWeight,
          healthDiet: profile?.healthDiet,
          lifestyleDiet: profile?.lifestyleDiet,
          latestWeight: parseNumber(weightText) ?? latestWeight ?? undefined,
          latestMuscleMass: parseNumber(muscleText),
          latestBodyFat: parseNumber(bodyFatText),
          recentBodyLogs: sortedBodyLogs,
          recentFoodLogs: foodLogs,
        }),
        history: [],
        userContext: {
          feature: 'body_tracker_analysis',
          targetWeight: profile?.targetWeight,
          currentWeight: profile?.currentWeight,
          latestWeight: parseNumber(weightText) ?? latestWeight ?? null,
          bodyGoal: profile?.bodyGoal,
          healthDiet: profile?.healthDiet,
          lifestyleDiet: profile?.lifestyleDiet,
          recentBodyLogs: sortedBodyLogs.slice(0, 14),
          recentFoodLogs: foodLogs.slice(0, 12).map((log) => ({
            dishName: log.analysis?.dishName,
            calories: log.analysis?.macros?.calories,
            protein_g: log.analysis?.macros?.protein_g,
            carbs_g: log.analysis?.macros?.carbs_g,
            fat_g: log.analysis?.macros?.fat_g,
            timestamp: log.timestamp,
          })),
        },
      });

      setAnalysisText(sanitizeAiText(String(response?.data?.reply || '').trim()));
      if (response?.data?.token) {
        setTokenStatus({
          remaining: Number(response.data.token.remaining || 0),
          limit: Number(response.data.token.limit || planLimits.chatTokensMonthly),
          used: Number(response.data.token.used || 0),
          planId: String(response.data.token.planId || profile?.plan_id || 'free'),
        });
      }
    } catch (e: any) {
      alert({ title: '분석 실패', message: String(e?.message || e || 'AI 분석 중 오류가 발생했어요.') });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleBackPress = () => {
    resetToMainTab('Profile');
  };

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        handleBackPress();
        return true;
      };

      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [resetToMainTab])
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}> 
          <TouchableOpacity onPress={handleBackPress} style={styles.headerButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <AppIcon name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>오늘 몸무게</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: MAIN_SHORTCUT_BAR_HEIGHT + 28 }]}>
          <Card style={styles.heroCard}>
            <View style={styles.heroRow}>
              <View style={[styles.heroIcon, { backgroundColor: colors.blue50, borderColor: colors.border }]}> 
                <AppIcon name="monitor-weight" size={24} color={colors.primaryDark} />
              </View>
              <View style={styles.heroTextCol}>
                <Text style={[styles.heroTitle, { color: colors.text }]}>매일 몸 상태를 기록해보세요</Text>
                <Text style={[styles.heroDesc, { color: colors.textSecondary }]}>체중, 골격근량, 체지방량과 최근 식사 흐름을 함께 보고 AI가 분석해줘요.</Text>
              </View>
            </View>
          </Card>

          <View style={styles.summaryRow}>
            <Card style={styles.summaryCard}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>현재 체중</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>{formatMetric(latestWeight)}</Text>
            </Card>
            <Card style={styles.summaryCard}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>목표 체중</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>{formatMetric(targetWeight)}</Text>
            </Card>
          </View>

          <Card style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>최근 체중 그래프</Text>
              {todayLog ? <Badge variant="secondary" text="오늘 입력 완료" /> : <Badge variant="outline" text="오늘 입력 필요" />}
            </View>

            {chartMeta ? (
              <>
                <View style={[styles.chartWrap, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}> 
                  <Svg width={chartWidth} height={chartHeight}>
                    {chartMeta.yTicks.map((tick, index) => (
                      <React.Fragment key={`tick-${tick.value}`}>
                        <SvgText
                          x={chartMeta.plotStartX - 8}
                          y={tick.y + 4}
                          fontSize="11"
                          fill={colors.textSecondary}
                          textAnchor="end"
                        >
                          {tick.value}
                        </SvgText>
                        <Line
                          x1={chartMeta.plotStartX}
                          y1={tick.y}
                          x2={chartMeta.plotEndX}
                          y2={tick.y}
                          stroke={index === 0 || index === chartMeta.yTicks.length - 1 ? colors.border : colors.surfaceMuted}
                          strokeWidth="1"
                        />
                      </React.Fragment>
                    ))}
                    <Line x1={chartMeta.plotStartX} y1={chartHeight - chartPaddingY} x2={chartMeta.plotEndX} y2={chartHeight - chartPaddingY} stroke={colors.border} strokeWidth="1" />
                    <Line x1={chartMeta.plotStartX} y1={chartPaddingY} x2={chartMeta.plotStartX} y2={chartHeight - chartPaddingY} stroke={colors.border} strokeWidth="1" />
                    {typeof chartMeta.latestReferenceY === 'number' ? (
                      <Line
                        x1={chartMeta.plotStartX}
                        y1={chartMeta.latestReferenceY}
                        x2={chartMeta.plotEndX}
                        y2={chartMeta.latestReferenceY}
                        stroke={colors.primaryDark}
                        strokeWidth="1.5"
                        strokeDasharray="6 4"
                        opacity={0.7}
                      />
                    ) : null}
                    <Polyline fill="none" stroke={colors.primaryDark} strokeWidth="3" points={chartMeta.polyline} />
                    {chartMeta.points.map((point, index) => (
                      <Circle key={`point-${index}`} cx={point.x} cy={point.y} r="4" fill={colors.primaryDark} />
                    ))}
                  </Svg>
                </View>
                <View style={styles.chartLabelsRow}>
                  {chartMeta.points.map((point, index) => (
                    <View key={`label-${index}`} style={styles.chartLabelItem}>
                      <Text style={[styles.chartLabelText, { color: colors.textSecondary }]}>{point.label}</Text>
                      <Text style={[styles.chartValueText, { color: colors.text }]}>{point.value.toFixed(1)}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <View style={[styles.emptyBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}> 
                <AppIcon name="show-chart" size={22} color={colors.textSecondary} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 그래프 데이터가 없어요</Text>
                <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>오늘 몸무게를 입력하면 매일매일 변화가 쌓여서 보여요.</Text>
              </View>
            )}
          </Card>

          <Card style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Badge variant="outline" text={todayKey} />
            </View>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>몸무게</Text>
            <TextInput
              value={weightText}
              onChangeText={setWeightText}
              keyboardType="decimal-pad"
              placeholder="예: 63.4"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>골격근량</Text>
            <TextInput
              value={muscleText}
              onChangeText={setMuscleText}
              keyboardType="decimal-pad"
              placeholder="예: 24.1"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>체지방량</Text>
            <TextInput
              value={bodyFatText}
              onChangeText={setBodyFatText}
              keyboardType="decimal-pad"
              placeholder="예: 16.3"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceElevated }]}
            />

            <Button
              title={isSaving ? '저장 중...' : todayLog ? '오늘 기록 수정하기' : '오늘 기록 저장하기'}
              onPress={handleSaveToday}
              loading={isSaving}
              style={styles.primaryButton}
              icon={<AppIcon name="check" size={18} color="#FFFFFF" />}
            />
          </Card>

          <Card style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>AI 몸 상태 분석</Text>
              <Badge variant="warning" text="챗봇 토큰 사용" />
            </View>
            <Text style={[styles.noticeText, { color: colors.textSecondary }]}>분석하기를 누르면 최근 몸무게 기록과 히스토리를 같이 보고 챗봇 토큰이 소모돼요.</Text>

            <View style={[styles.tokenBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}> 
              <View style={styles.tokenRow}>
                <Text style={[styles.tokenLabel, { color: colors.textSecondary }]}>남은 토큰</Text>
                <Text style={[styles.tokenValue, { color: colors.text }]}>
                  {typeof tokenStatus?.remaining === 'number'
                    ? `${tokenStatus.remaining.toLocaleString()} / ${(tokenStatus.limit || planLimits.chatTokensMonthly).toLocaleString()}`
                    : `${planLimits.chatTokensMonthly.toLocaleString()} / ${planLimits.chatTokensMonthly.toLocaleString()}`}
                </Text>
              </View>
              <View style={styles.tokenRow}>
                <Text style={[styles.tokenLabel, { color: colors.textSecondary }]}>사용 플랜</Text>
                <Text style={[styles.tokenValue, { color: colors.text }]}>{String(tokenStatus?.planId || profile?.plan_id || 'free').toUpperCase()}</Text>
              </View>
            </View>

            <Button
              title={isAnalyzing ? '분석 중...' : '분석하기'}
              onPress={handleAnalyze}
              loading={isAnalyzing}
              style={styles.primaryButton}
              icon={<AppIcon name="smart-toy" size={18} color="#FFFFFF" />}
            />

            <View style={[styles.analysisBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}> 
              {analysisText ? (
                <Text style={[styles.analysisText, { color: colors.text }]}>{analysisText}</Text>
              ) : (
                <Text style={[styles.analysisPlaceholder, { color: colors.textSecondary }]}>체중 변화와 최근 식단을 바탕으로 감량/유지/벌크업 방향을 분석해드려요.</Text>
              )}
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
      <MainShortcutBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundGray,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    minHeight: 56,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    paddingHorizontal: 16,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  heroCard: {
    padding: 16,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextCol: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  heroDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    padding: 16,
  },
  summaryLabel: {
    fontSize: 13,
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '900',
  },
  card: {
    padding: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  chartWrap: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 4,
  },
  chartLabelItem: {
    flex: 1,
    alignItems: 'center',
  },
  chartLabelText: {
    fontSize: 11,
    marginBottom: 2,
  },
  chartValueText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyBox: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 12,
  },
  primaryButton: {
    marginTop: 8,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  tokenBox: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  tokenRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  tokenLabel: {
    fontSize: 13,
  },
  tokenValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  analysisBox: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 14,
    minHeight: 130,
  },
  analysisText: {
    fontSize: 14,
    lineHeight: 22,
  },
  analysisPlaceholder: {
    fontSize: 14,
    lineHeight: 22,
  },
});
