import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { useAppAlert } from '../../components/ui/AppAlert';
import { ManualLogEditor } from '../../components/editor/ManualLogEditor';
import { useUserStore } from '../../store/userStore';
import type { ManualMealLog } from '../../types/user';
import { useTheme } from '../../theme/ThemeProvider';
import {
  deleteManualMealLogRemote,
  getSessionUserId,
  insertManualMealLogRemote,
  listManualMealLogsRemote,
  updateManualMealLogRemote,
  upsertManualMealLogsRemote,
} from '../../services/userData';

type MealType = ManualMealLog['mealType'];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '아침',
  lunch: '점심',
  dinner: '저녁',
  snack: '간식',
};

const MEAL_ORDER: Record<MealType, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthLabel(d: Date) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

type MacroTotals = { calories: number; carbs_g: number; protein_g: number; fat_g: number };

function addTotals(a: MacroTotals, b: MacroTotals): MacroTotals {
  return {
    calories: a.calories + b.calories,
    carbs_g: a.carbs_g + b.carbs_g,
    protein_g: a.protein_g + b.protein_g,
    fat_g: a.fat_g + b.fat_g,
  };
}

function toText(v: number | undefined) {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function parseNumOrUndefined(s: string): number | undefined {
  const t = String(s ?? '').trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, n);
}

function GoalEditor(props: {
  initial: { calories?: number; carbs?: number; protein?: number; fat?: number };
  onSave: (next: { calories?: number; carbs?: number; protein?: number; fat?: number }) => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const [calories, setCalories] = useState(toText(props.initial.calories));
  const [carbs, setCarbs] = useState(toText(props.initial.carbs));
  const [protein, setProtein] = useState(toText(props.initial.protein));
  const [fat, setFat] = useState(toText(props.initial.fat));

  return (
    <View style={styles.goalEditorRoot}>
      <View style={styles.goalEditorGrid}>
        <View style={styles.goalEditorField}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>칼로리(kcal)</Text>
          <TextInput
            value={calories}
            onChangeText={setCalories}
            keyboardType="numeric"
            placeholder="예: 2000"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
        <View style={styles.goalEditorField}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>탄수(g)</Text>
          <TextInput
            value={carbs}
            onChangeText={setCarbs}
            keyboardType="numeric"
            placeholder="예: 250"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
        <View style={styles.goalEditorField}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>단백질(g)</Text>
          <TextInput
            value={protein}
            onChangeText={setProtein}
            keyboardType="numeric"
            placeholder="예: 120"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
        <View style={styles.goalEditorField}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>지방(g)</Text>
          <TextInput
            value={fat}
            onChangeText={setFat}
            keyboardType="numeric"
            placeholder="예: 60"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
          />
        </View>
      </View>

      <Button
        title="저장"
        onPress={() =>
          props.onSave({
            calories: parseNumOrUndefined(calories),
            carbs: parseNumOrUndefined(carbs),
            protein: parseNumOrUndefined(protein),
            fat: parseNumOrUndefined(fat),
          })
        }
      />
    </View>
  );
}

export default function CalendarScreen() {
  const navigation = useNavigation<any>();
  const { alert, dismiss } = useAppAlert();
  const { colors } = useTheme();

  const profile = useUserStore(state => state.profile);
  const updateProfile = useUserStore(state => state.updateProfile);

  const manualMealLogs = useUserStore(state => state.manualMealLogs);
  const loadManualMealLogs = useUserStore(state => state.loadManualMealLogs);
  const addManualMealLog = useUserStore(state => state.addManualMealLog);
  const updateManualMealLog = useUserStore(state => state.updateManualMealLog);
  const removeManualMealLog = useUserStore(state => state.removeManualMealLog);
  const setManualMealLogs = useUserStore(state => state.setManualMealLogs);

  const today = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => toYmd(today), [today]);
  const [activeMonth, setActiveMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => toYmd(today));

  const goalCal = typeof profile?.targetCalories === 'number' ? profile.targetCalories : undefined;
  const goalCarb = typeof profile?.targetCarbs === 'number' ? profile.targetCarbs : undefined;
  const goalProt = typeof profile?.targetProtein === 'number' ? profile.targetProtein : undefined;
  const goalF = typeof profile?.targetFat === 'number' ? profile.targetFat : undefined;

  const [isEditing, setIsEditing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      void (async () => {
        const userId = await getSessionUserId().catch(() => null);
        if (!alive) return;

        if (!userId) {
          await loadManualMealLogs();
          return;
        }

        const remoteLogs = await listManualMealLogsRemote(1000).catch(() => null);
        if (!alive) return;

        if (Array.isArray(remoteLogs)) {
          await setManualMealLogs(remoteLogs);
          return;
        }

        retryTimer = setTimeout(() => {
          if (!alive) return;
          void (async () => {
            const retried = await listManualMealLogsRemote(1000).catch(() => null);
            if (alive && Array.isArray(retried)) {
              await setManualMealLogs(retried);
            }
          })();
        }, 900);
      })();

      return () => {
        alive = false;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }, [loadManualMealLogs, setManualMealLogs])
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        setIsEditing(false);
        dismiss();
      };
    }, [dismiss])
  );

  const openGoalEditor = useCallback(() => {
    alert({
      title: '목표(제한량) 설정',
      message: '한 번 설정해두면 매일 동일하게 적용돼요. 언제든 수정할 수 있어요.',
      content: (
        <GoalEditor
          initial={{
            calories: goalCal,
            carbs: goalCarb,
            protein: goalProt,
            fat: goalF,
          }}
          onSave={async (next) => {
            await updateProfile({
              targetCalories: next.calories,
              targetCarbs: next.carbs,
              targetProtein: next.protein,
              targetFat: next.fat,
            });
            dismiss();
          }}
        />
      ),
      actions: [{ text: '닫기', variant: 'outline' }],
    });
  }, [alert, dismiss, goalCal, goalCarb, goalF, goalProt, updateProfile]);

  const monthKey = useMemo(() => `${activeMonth.getFullYear()}-${pad2(activeMonth.getMonth() + 1)}`, [activeMonth]);

  useEffect(() => {
    if (!selectedDate.startsWith(monthKey)) {
      setSelectedDate(`${activeMonth.getFullYear()}-${pad2(activeMonth.getMonth() + 1)}-01`);
    }
  }, [activeMonth, monthKey, selectedDate]);

  const logsByDate = useMemo(() => {
    const map: Record<string, ManualMealLog[]> = {};
    for (const log of manualMealLogs || []) {
      const k = String(log?.date ?? '').trim();
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push(log);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const aOrder = MEAL_ORDER[a.mealType] ?? 99;
        const bOrder = MEAL_ORDER[b.mealType] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
      });
    }
    return map;
  }, [manualMealLogs]);

  const selectedLogs = useMemo(() => logsByDate[selectedDate] || [], [logsByDate, selectedDate]);

  const todayLogs = useMemo(() => logsByDate[todayYmd] || [], [logsByDate, todayYmd]);

  const todayTotals = useMemo<MacroTotals>(() => {
    return (todayLogs || []).reduce(
      (acc, log) =>
        addTotals(acc, {
          calories: Number(log.calories) || 0,
          carbs_g: Number(log.carbs_g) || 0,
          protein_g: Number(log.protein_g) || 0,
          fat_g: Number(log.fat_g) || 0,
        }),
      { calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0 },
    );
  }, [todayLogs]);

  const openChatWithTodaySummary = useCallback(() => {
    const lines: string[] = [];
    lines.push(`오늘(${todayYmd}) 식단 합계 분석 부탁해요.`);
    lines.push('다음 식사/메뉴 추천은 하지 말고, 목표 대비 분석과 개선점만 알려줘.');
    lines.push('');
    lines.push(`- 칼로리: ${Math.round(todayTotals.calories)} kcal`);
    lines.push(`- 탄수화물: ${Math.round(todayTotals.carbs_g)} g`);
    lines.push(`- 단백질: ${Math.round(todayTotals.protein_g)} g`);
    lines.push(`- 지방: ${Math.round(todayTotals.fat_g)} g`);

    if ((todayLogs || []).length > 0) {
      lines.push('');
      lines.push('기록:');
      for (const log of todayLogs) {
        lines.push(
          `- ${MEAL_LABELS[log.mealType]}${log.foodName ? `(${log.foodName})` : ''}: ${Math.round(log.calories)}kcal (탄수 ${Math.round(log.carbs_g)}g / 단백질 ${Math.round(log.protein_g)}g / 지방 ${Math.round(log.fat_g)}g)`
        );
      }
    }

    const prefillMessage = lines.join('\n');
    navigation.navigate('Chat', { prefillMessage, autoSend: true });
  }, [navigation, todayLogs, todayTotals, todayYmd]);

  const selectedTotals = useMemo<MacroTotals>(() => {
    return (selectedLogs || []).reduce(
      (acc, log) => addTotals(acc, {
        calories: Number(log.calories) || 0,
        carbs_g: Number(log.carbs_g) || 0,
        protein_g: Number(log.protein_g) || 0,
        fat_g: Number(log.fat_g) || 0,
      }),
      { calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0 },
    );
  }, [selectedLogs]);

  const dayTotalsMap = useMemo(() => {
    const out: Record<string, MacroTotals> = {};
    for (const log of manualMealLogs || []) {
      const d = String(log?.date ?? '');
      if (!d.startsWith(monthKey)) continue;
      if (!out[d]) out[d] = { calories: 0, carbs_g: 0, protein_g: 0, fat_g: 0 };
      out[d] = addTotals(out[d], {
        calories: Number(log.calories) || 0,
        carbs_g: Number(log.carbs_g) || 0,
        protein_g: Number(log.protein_g) || 0,
        fat_g: Number(log.fat_g) || 0,
      });
    }
    return out;
  }, [manualMealLogs, monthKey]);

  const calendarCells = useMemo(() => {
    const y = activeMonth.getFullYear();
    const m = activeMonth.getMonth();
    const firstWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const cells: Array<{ key: string; ymd?: string; day?: number }> = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ key: `blank_${i}` });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m, day);
      cells.push({ key: toYmd(d), ymd: toYmd(d), day });
    }
    return cells;
  }, [activeMonth]);

  const goPrevMonth = useCallback(() => {
    setActiveMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const goNextMonth = useCallback(() => {
    setActiveMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  const openAddLog = useCallback(() => {
    const userId = profile?.id || '';
    const draft: ManualMealLog = {
      id: 'draft',
      userId,
      date: selectedDate,
      mealType: 'breakfast',
      foodName: undefined,
      calories: 0,
      carbs_g: 0,
      protein_g: 0,
      fat_g: 0,
      imageUri: undefined,
      timestamp: new Date().toISOString(),
    };

    alert({
      title: '기록 추가',
      message: selectedDate,
      content: (
        <ManualLogEditor
          initial={draft}
          submitLabel="추가"
          onClose={dismiss}
          onSubmit={async (updates) => {
            const sessionUserId = await getSessionUserId().catch(() => null);
            if (!sessionUserId) throw new Error('로그인 상태에서만 캘린더 기록을 저장할 수 있어요.');

            const newLog: ManualMealLog = {
              ...draft,
              ...updates,
              id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
              userId: sessionUserId,
              date: selectedDate,
              timestamp: new Date().toISOString(),
            };

            await insertManualMealLogRemote(newLog);
            const remoteLogs = await listManualMealLogsRemote(1000);
            await setManualMealLogs(remoteLogs);
            dismiss();
          }}
        />
      ),
      actions: [],
    });
  }, [alert, dismiss, profile?.id, selectedDate, setManualMealLogs]);

  const openEditLog = useCallback(
    (log: ManualMealLog) => {
      alert({
        title: '기록 편집',
        message: `${log.date} · ${MEAL_LABELS[log.mealType]}`,
        content: (
          <ManualLogEditor
            initial={log}
            submitLabel="저장"
            onClose={dismiss}
            onSubmit={async (updates) => {
              const sessionUserId = await getSessionUserId().catch(() => null);
              if (!sessionUserId) throw new Error('로그인 상태에서만 캘린더 기록을 수정할 수 있어요.');
              await updateManualMealLogRemote(log.id, updates);
              const remoteLogs = await listManualMealLogsRemote(1000);
              await setManualMealLogs(remoteLogs);
              dismiss();
            }}
          />
        ),
        actions: [],
      });
    },
    [alert, dismiss, setManualMealLogs]
  );

  const confirmDeleteLog = useCallback(
    (log: ManualMealLog) => {
      alert({
        title: '기록 삭제',
        message: `${log.date} · ${MEAL_LABELS[log.mealType]} 기록을 삭제할까요?`,
        actions: [
          { text: '취소', variant: 'outline' },
          {
            text: '삭제',
            variant: 'danger',
            onPress: () => {
              void (async () => {
                const sessionUserId = await getSessionUserId().catch(() => null);
                if (!sessionUserId) throw new Error('로그인 상태에서만 캘린더 기록을 삭제할 수 있어요.');
                await deleteManualMealLogRemote(log.id);
                const remoteLogs = await listManualMealLogsRemote(1000);
                await setManualMealLogs(remoteLogs);
              })();
            },
          },
        ],
      });
    },
    [alert, setManualMealLogs]
  );

  const overCal = typeof goalCal === 'number' && selectedTotals.calories > goalCal;
  const overCarb = typeof goalCarb === 'number' && selectedTotals.carbs_g > goalCarb;
  const overProt = typeof goalProt === 'number' && selectedTotals.protein_g > goalProt;
  const overFat = typeof goalF === 'number' && selectedTotals.fat_g > goalF;

  const hasAnyGoal = [goalCal, goalCarb, goalProt, goalF].some(v => typeof v === 'number');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>캘린더</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        <Card style={styles.calendarCard} variant="elevated">
          <View style={styles.monthHeader}>
            <TouchableOpacity onPress={goPrevMonth} style={styles.monthNavBtn} accessibilityRole="button" accessibilityLabel="이전 달">
              <AppIcon name="chevron-left" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.monthLabel, { color: colors.text }]}>{monthLabel(activeMonth)}</Text>
            <TouchableOpacity onPress={goNextMonth} style={styles.monthNavBtn} accessibilityRole="button" accessibilityLabel="다음 달">
              <AppIcon name="chevron-right" size={26} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdaysRow}>
            {WEEKDAYS.map(w => (
              <Text key={w} style={[styles.weekdayText, { color: colors.textSecondary }]}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {calendarCells.map(cell => {
              if (!cell.ymd || !cell.day) {
                return <View key={cell.key} style={[styles.cell, styles.cellBlank]} />;
              }

              const ymd = cell.ymd;
              const isSelected = ymd === selectedDate;
              const isToday = ymd === todayYmd;
              const totals = dayTotalsMap[ymd];
              const hasLogs = (totals?.calories ?? 0) > 0;

              return (
                <TouchableOpacity
                  key={cell.key}
                  onPress={() => setSelectedDate(ymd)}
                  style={[
                    styles.cell,
                    { backgroundColor: colors.surface, borderColor: colors.surfaceMuted },
                    isToday && !isSelected && [styles.cellToday, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }],
                    isSelected && [styles.cellSelected, { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted }],
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${ymd} 선택`}
                >
                  <Text style={[styles.cellDay, { color: colors.text }, isToday && !isSelected && { color: colors.text }, isSelected && { color: colors.text }]}>
                    {cell.day}
                  </Text>
                  {hasLogs ? (
                    <Text style={[styles.cellSub, { color: colors.textSecondary }, isSelected && { color: colors.textSecondary }]} numberOfLines={1}>
                      {Math.round(totals.calories)}kcal
                    </Text>
                  ) : (
                    <View style={styles.cellSubPlaceholder} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Card style={styles.sectionCard} variant="elevated">
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{selectedDate} 합계</Text>
            <View style={styles.headerButtons}>
              <Button variant="outline" size="sm" title="챗봇에 물어보기" onPress={openChatWithTodaySummary} />
            </View>
          </View>

          <View style={styles.totalsGrid}>
            <Text style={[styles.totalItem, { color: colors.text }, overCal && styles.totalOver]}>칼로리 {Math.round(selectedTotals.calories)} kcal</Text>
            <Text style={[styles.totalItem, { color: colors.text }, overCarb && styles.totalOver]}>탄수 {Math.round(selectedTotals.carbs_g)} g</Text>
            <Text style={[styles.totalItem, { color: colors.text }, overProt && styles.totalProteinGood]}>단백질 {Math.round(selectedTotals.protein_g)} g</Text>
            <Text style={[styles.totalItem, { color: colors.text }, overFat && styles.totalOver]}>지방 {Math.round(selectedTotals.fat_g)} g</Text>
          </View>

          <View style={[styles.goalSummary, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated }]}>
            <View style={styles.goalHeaderRow}>
              <Text style={[styles.goalTitle, { color: colors.text }]}>목표(제한량)</Text>
              {hasAnyGoal ? (
                <TouchableOpacity onPress={openGoalEditor} accessibilityRole="button" accessibilityLabel="목표 수정">
                  <Text style={[styles.goalEditText, { color: colors.textSecondary }]}>수정</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {hasAnyGoal ? (
              <Text style={[styles.goalText, { color: colors.textSecondary }]}>
                {typeof goalCal === 'number' ? `${Math.round(goalCal)}kcal` : '-'} ·
                탄수 {typeof goalCarb === 'number' ? `${Math.round(goalCarb)}g` : '-'} ·
                단백질 {typeof goalProt === 'number' ? `${Math.round(goalProt)}g` : '-'} ·
                지방 {typeof goalF === 'number' ? `${Math.round(goalF)}g` : '-'}
              </Text>
            ) : (
              <View style={styles.goalEmptyRow}>
                <Text style={[styles.goalEmptyText, { color: colors.textSecondary }]}>목표를 설정해보세요</Text>
                <Button size="sm" title="목표 설정" onPress={openGoalEditor} />
              </View>
            )}
          </View>
        </Card>

        <Card style={styles.sectionCard} variant="elevated">
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>기록</Text>
            <View style={styles.headerButtons}>
              <Button
                variant="outline"
                size="sm"
                title={isEditing ? '완료' : '편집'}
                onPress={() => setIsEditing(v => !v)}
              />
              <Button variant="primary" size="sm" title="기록 추가" onPress={openAddLog} />
            </View>
          </View>

          {selectedLogs.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated }] }>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>아직 기록이 없어요</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>"기록 추가"를 눌러 오늘 먹은 것을 저장해보세요.</Text>
            </View>
          ) : (
            <View style={styles.listBox}>
              {selectedLogs.map(log => (
                <View key={log.id} style={[styles.logRow, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated }]}>
                  <View style={styles.logLeft}>
                    {log.imageUri ? (
                      <Image source={{ uri: log.imageUri }} style={styles.logThumb} />
                    ) : (
                      <View style={[styles.logThumb, styles.logThumbFallback, { borderColor: colors.surfaceMuted, backgroundColor: colors.surface }]}>
                        <AppIcon name="image" size={18} color={colors.textSecondary} />
                      </View>
                    )}
                    <View style={styles.logTextBox}>
                      <Text style={[styles.logTitle, { color: colors.text }]}>
                        {MEAL_LABELS[log.mealType]}
                        {log.foodName ? ` · ${log.foodName}` : ''}
                      </Text>
                      <Text style={[styles.logSub, { color: colors.textSecondary }]} numberOfLines={1}>
                        {Math.round(log.calories)}kcal · 탄수 {Math.round(log.carbs_g)}g · 단백질 {Math.round(log.protein_g)}g · 지방 {Math.round(log.fat_g)}g
                      </Text>
                    </View>
                  </View>

                  {isEditing ? (
                    <View style={styles.logActions}>
                      <TouchableOpacity
                        onPress={() => openEditLog(log)}
                        accessibilityRole="button"
                        accessibilityLabel="기록 수정"
                      >
                        <Text style={[styles.logActionEdit, { color: colors.textSecondary }]}>수정</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => confirmDeleteLog(log)}
                        accessibilityRole="button"
                        accessibilityLabel="기록 삭제"
                      >
                        <Text style={[styles.logActionDelete, { color: colors.danger }]}>삭제</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundGray,
  },
  header: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
  calendarCard: {
    padding: SPACING.md,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  monthNavBtn: {
    padding: 6,
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  weekdaysRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayText: {
    width: '14.2857%',
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontWeight: '700',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.2857%',
    paddingVertical: 10,
    paddingHorizontal: 2,
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  cellBlank: {
    opacity: 0,
  },
  cellToday: {
    borderWidth: 1,
    borderColor: COLORS.blue200,
  },
  cellSelected: {
    backgroundColor: COLORS.blue50,
    borderWidth: 1,
    borderColor: COLORS.blue200,
  },
  cellDay: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  cellDayToday: {
    color: COLORS.primary,
  },
  cellDaySelected: {
    color: COLORS.primary,
  },
  cellSub: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  cellSubSelected: {
    color: COLORS.primary,
  },
  cellSubPlaceholder: {
    height: 16,
  },

  sectionCard: {
    padding: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  totalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  totalItem: {
    width: '48%',
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  totalOver: {
    color: COLORS.danger,
  },
  totalProteinGood: {
    color: COLORS.success,
  },

  goalSummary: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 12,
    gap: 6,
  },
  goalTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalEditText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
  },
  goalText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  goalEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  goalEmptyText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },

  addBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
  },
  goalEditorRoot: {
    gap: 12,
  },
  goalEditorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  goalEditorField: {
    width: '48%',
    gap: 6,
  },
  mealTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mealChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
  },
  mealChipActive: {
    borderColor: COLORS.blue200,
    backgroundColor: COLORS.blue50,
  },
  mealChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textSecondary,
  },
  mealChipTextActive: {
    color: COLORS.primary,
  },

  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  photoThumb: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  photoThumbPlaceholder: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },

  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  formField: {
    width: '48%',
    gap: 6,
  },

  emptyBox: {
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  emptyDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },

  listBox: {
    gap: 10,
  },
  logRow: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 12,
    backgroundColor: COLORS.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  logLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  logActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logActionEdit: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.primary,
  },
  logActionDelete: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.danger,
  },
  logThumb: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    resizeMode: 'cover',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logTextBox: {
    flex: 1,
    gap: 2,
  },
  logTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  logSub: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});
