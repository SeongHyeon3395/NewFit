import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { useAppAlert } from '../../components/ui/AppAlert';
import { COLORS } from '../../constants/colors';
import type { MealPlanDay } from '../../types/mealPlan';
import type { MealPlanLog } from '../../services/userData';
import { deleteMealPlanLogRemote, getMealPlanLogRemote } from '../../services/userData';
import { retryAsync } from '../../services/retry';
import { useTheme } from '../../theme/ThemeProvider';

export default function MealPlanDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { alert } = useAppAlert();
  const { colors } = useTheme();

  const { id } = route.params as { id: number };
  const [log, setLog] = useState<MealPlanLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setLoadFailed(false);
        const data = await retryAsync(() => getMealPlanLogRemote(id), { retries: 1, delayMs: 700 });
        if (!mounted) return;
        setLog(data);
      } catch {
        if (!mounted) return;
        setLoadFailed(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  const result = log?.result;

  const headerLabel = useMemo<string>(() => {
    try {
      return log?.occurredAt ? new Date(log.occurredAt).toLocaleString('ko-KR') : '';
    } catch {
      return String(log?.occurredAt || '');
    }
  }, [log?.occurredAt]);

  const modeLabel = result?.mode === 'pantry' ? '보유음식기반' : '하루 식단';

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
        <Text style={[styles.mealLabel, { color: colors.textSecondary }]}>{label}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mealName, { color: colors.text }]} numberOfLines={2}>
            {name || '-'}
          </Text>
          <Text style={[styles.mealMeta, { color: colors.textSecondary }]}>
            {Number.isFinite(grams) ? `${Math.round(grams)}g` : '-'} · {Number.isFinite(cal) ? `${Math.round(cal)} kcal` : '-'}
            {'  '}| 탄 {Number.isFinite(carbs) ? Math.round(carbs) : '-'}g · 단 {Number.isFinite(protein) ? Math.round(protein) : '-'}g · 지 {Number.isFinite(fat) ? Math.round(fat) : '-'}g
          </Text>
        </View>
      </View>
    );
  };

  const planDays: MealPlanDay[] = Array.isArray(result?.plan) ? result.plan : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]}>
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button">
          <AppIcon name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>식단 기록</Text>
        <TouchableOpacity
          onPress={() => {
            if (!log) return;
            alert({
              title: '기록 삭제',
              message: '이 식단 기록을 삭제할까요?',
              actions: [
                { text: '취소', variant: 'outline' },
                {
                  text: '삭제',
                  variant: 'danger',
                  onPress: async () => {
                    try {
                      await retryAsync(() => deleteMealPlanLogRemote(log.id), { retries: 1, delayMs: 700 });
                      navigation.goBack();
                    } catch (e: any) {
                      alert({
                        title: '삭제 실패',
                        message: String(e?.message || e || 'UNKNOWN_ERROR'),
                      });
                    }
                  },
                },
              ],
            });
          }}
          style={styles.headerRightBtn}
          accessibilityRole="button"
        >
          <AppIcon name="delete" size={22} color={colors.destructive} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.text} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>불러오는 중…</Text>
          </View>
        ) : null}

        {!loading && loadFailed ? (
          <Card style={styles.errorCard} variant="elevated">
            <Text style={[styles.errorTitle, { color: colors.text }]}>기록을 다시 불러오지 못했어요</Text>
            <Text style={[styles.errorSub, { color: colors.textSecondary }]}>네트워크가 잠시 불안정할 수 있어요. 기존 화면 데이터는 유지했어요.</Text>
          </Card>
        ) : null}

        <Card style={styles.metaCard} variant="elevated">
          <View style={styles.metaRow}>
            <Badge variant="secondary" text={modeLabel} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>{headerLabel}</Text>
          </View>
          {Array.isArray(result?.notes) && result.notes.length > 0 ? (
            <Text style={[styles.note, { color: colors.textSecondary }]}>{String(result.notes[0])}</Text>
          ) : null}
        </Card>

        {planDays.length === 0 ? (
          <Card style={styles.emptyCard} variant="elevated">
            <Text style={[styles.emptyTitle, { color: colors.text }]}>표시할 식단이 없어요</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>데이터 형식이 올바르지 않을 수 있습니다.</Text>
          </Card>
        ) : (
          <Card style={styles.planCard} variant="elevated">
            <Text style={[styles.sectionTitle, { color: colors.text }]}>하루 식단</Text>
            {planDays.map((d: any) => (
              <View key={`day-${d.day}`} style={[styles.dayBlock, { borderBottomColor: colors.border }]}>
                <Text style={[styles.dayTitle, { color: colors.text }]}>Day {d.day}</Text>
                {renderMealRow('아침', d?.meals?.breakfast)}
                {renderMealRow('점심', d?.meals?.lunch)}
                {renderMealRow('저녁', d?.meals?.dinner)}

                <View style={[styles.totalRow, { borderTopColor: colors.border }] }>
                  <Text style={[styles.totalLabel, { color: colors.text }]}>하루 총합</Text>
                  <Text style={[styles.totalValue, { color: colors.textSecondary }]}>
                    {Math.round(Number(d?.totals?.calories || 0))} kcal · 탄 {Math.round(Number(d?.totals?.carbs_g || 0))}g · 단 {Math.round(Number(d?.totals?.protein_g || 0))}g · 지 {Math.round(Number(d?.totals?.fat_g || 0))}g
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  headerRight: {
    width: 40,
    height: 40,
  },
  headerRightBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  loading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  errorCard: {
    padding: 14,
    marginTop: 16,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  errorSub: {
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textSecondary,
  },
  metaCard: {
    padding: 14,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  note: {
    marginTop: 10,
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyCard: {
    padding: 16,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  emptySub: {
    marginTop: 6,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  planCard: {
    padding: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.text,
    marginBottom: 8,
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
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
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
});
