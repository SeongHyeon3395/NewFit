import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { COLORS, SPACING, RADIUS } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { AppIcon } from '../../components/ui/AppIcon';
import { Button } from '../../components/ui/Button';
import { useUserStore } from '../../store/userStore';
import { BODY_GOALS, HEALTH_DIETS, LIFESTYLE_DIETS } from '../../constants';
import { fetchMyAppUser, getMonthlyChatTokenStatusRemote, getMonthlyMealPlanCountRemote, getMonthlyScanCountRemote } from '../../services/userData';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { getPlanLabel, getPlanLimits } from '../../services/plans';
import { useTheme } from '../../theme/ThemeProvider';

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function PersonalInfoScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const profile = useUserStore(state => state.profile);
  const setProfile = useUserStore(state => state.setProfile);
  const username = profile?.username || (profile?.email ? profile.email.split('@')[0] : '');
  const nickname = profile?.nickname || profile?.name || '';

  const [monthlyScanCount, setMonthlyScanCount] = useState<number | null>(null);
  const [monthlyMealPlanCount, setMonthlyMealPlanCount] = useState<number | null>(null);
  const [monthlyChatTokenRemaining, setMonthlyChatTokenRemaining] = useState<number | null>(null);

  const planLimits = useMemo(() => getPlanLimits(profile?.plan_id), [profile?.plan_id]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      (async () => {
        if (!isSupabaseConfigured || !supabase) return;
        try {
          const remote = await fetchMyAppUser();
          if (!alive) return;
          await setProfile(remote as any);
        } catch {
          // ignore
        }

        try {
          const [scanCount, mealPlanCount, chatTokenStatus] = await Promise.all([
            getMonthlyScanCountRemote().catch(() => null),
            getMonthlyMealPlanCountRemote().catch(() => null),
            getMonthlyChatTokenStatusRemote().catch(() => null),
          ]);
          if (!alive) return;
          const nextScan = typeof scanCount === 'number' ? scanCount : monthlyScanCount;
          const nextMeal = typeof mealPlanCount === 'number' ? mealPlanCount : monthlyMealPlanCount;
          const nextChat = typeof chatTokenStatus?.remaining === 'number' ? chatTokenStatus.remaining : monthlyChatTokenRemaining;

          setMonthlyScanCount(nextScan ?? null);
          setMonthlyMealPlanCount(nextMeal ?? null);
          setMonthlyChatTokenRemaining(nextChat ?? null);

          if (typeof scanCount !== 'number' || typeof mealPlanCount !== 'number') {
            retryTimer = setTimeout(() => {
              if (!alive) return;
              void (async () => {
                const [retryScan, retryMeal, retryChat] = await Promise.all([
                  getMonthlyScanCountRemote().catch(() => null),
                  getMonthlyMealPlanCountRemote().catch(() => null),
                  getMonthlyChatTokenStatusRemote().catch(() => null),
                ]);
                if (!alive) return;
                if (typeof retryScan === 'number') setMonthlyScanCount(retryScan);
                if (typeof retryMeal === 'number') setMonthlyMealPlanCount(retryMeal);
                if (typeof retryChat?.remaining === 'number') setMonthlyChatTokenRemaining(retryChat.remaining);
              })();
            }, 900);
          }
        } catch {
          if (!alive) return;
          retryTimer = setTimeout(() => {
            if (!alive) return;
            void (async () => {
              const [retryScan, retryMeal, retryChat] = await Promise.all([
                getMonthlyScanCountRemote().catch(() => null),
                getMonthlyMealPlanCountRemote().catch(() => null),
                getMonthlyChatTokenStatusRemote().catch(() => null),
              ]);
              if (!alive) return;
              if (typeof retryScan === 'number') setMonthlyScanCount(retryScan);
              if (typeof retryMeal === 'number') setMonthlyMealPlanCount(retryMeal);
              if (typeof retryChat?.remaining === 'number') setMonthlyChatTokenRemaining(retryChat.remaining);
            })();
          }, 900);
        }
      })();
      return () => {
        alive = false;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }, [setProfile, monthlyScanCount, monthlyMealPlanCount, monthlyChatTokenRemaining])
  );

  const formatNumber = (v: unknown, unit?: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return '설정 전';
    return unit ? `${v}${unit}` : String(v);
  };

  const bodyGoalLabel = useMemo(() => {
    if (!profile?.bodyGoal) return '설정 전';
    return BODY_GOALS.find(x => x.id === profile.bodyGoal)?.label || String(profile.bodyGoal);
  }, [profile?.bodyGoal]);

  const healthDietLabel = useMemo(() => {
    if (!profile?.healthDiet) return '설정 전';
    return HEALTH_DIETS.find(x => x.id === profile.healthDiet)?.label || String(profile.healthDiet);
  }, [profile?.healthDiet]);

  const lifestyleDietLabel = useMemo(() => {
    if (!profile?.lifestyleDiet) return '설정 전';
    return LIFESTYLE_DIETS.find(x => x.id === profile.lifestyleDiet)?.label || String(profile.lifestyleDiet);
  }, [profile?.lifestyleDiet]);

  const remainingScanThisMonth =
    typeof monthlyScanCount === 'number' ? Math.max(0, planLimits.monthlyScanLimit - monthlyScanCount) : null;
  const remainingMealPlanThisMonth =
    typeof monthlyMealPlanCount === 'number'
      ? Math.max(0, planLimits.monthlyMealPlanLimit - monthlyMealPlanCount)
      : null;

  if (!profile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <AppIcon name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>내 정보</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Card style={styles.card}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>안내</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>프로필 정보가 없습니다. 온보딩 또는 로그인 후 이용해주세요.</Text>
            <View style={{ height: 12 }} />
            <Button variant="outline" onPress={() => navigation.goBack()}>
              뒤로
            </Button>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppIcon name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>내 정보</Text>
        <TouchableOpacity style={styles.editButton} onPress={() => navigation.navigate('EditPersonalInfo' as never)}>
          <Text style={[styles.editButtonText, { color: colors.primary }]}>수정</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>계정</Text>
          <InfoRow label="아이디" value={username || '로그인 후 표시'} />
          <InfoRow label="닉네임" value={nickname || '로그인 후 표시'} />
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>내 설정</Text>
          <InfoRow label="체형 목표" value={bodyGoalLabel} />
          <InfoRow label="건강 목적" value={healthDietLabel} />
          <InfoRow label="식습관" value={lifestyleDietLabel} />
          <InfoRow label="알레르기" value={profile?.allergens?.length ? profile.allergens.join(', ') : '없음'} />
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>신체 정보</Text>
          <InfoRow label="현재 체중" value={formatNumber(profile.currentWeight, 'kg')} />
          <InfoRow label="목표 체중" value={formatNumber(profile.targetWeight, 'kg')} />
          <InfoRow label="키" value={formatNumber(profile.height, 'cm')} />
          <InfoRow label="나이" value={formatNumber(profile.age, '세')} />
          <InfoRow
            label="성별"
            value={
              profile.gender === 'male'
                ? '남'
                : profile.gender === 'female'
                  ? '여'
                  : '설정 전'
            }
          />
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>플랜</Text>
          <InfoRow label="플랜" value={`${getPlanLabel(profile?.plan_id)} 플랜`} />
          <InfoRow
            label="이번 달 남은 스캔"
            value={
              typeof remainingScanThisMonth === 'number'
                ? `${remainingScanThisMonth}/${planLimits.monthlyScanLimit}`
                : '-'
            }
          />
          <InfoRow
            label="이번 달 남은 식단 생성"
            value={
              typeof remainingMealPlanThisMonth === 'number'
                ? `${remainingMealPlanThisMonth}/${planLimits.monthlyMealPlanLimit}`
                : '-'
            }
          />
          <InfoRow
            label="이번 달 남은 챗봇 토큰"
            value={
              typeof monthlyChatTokenRemaining === 'number'
                ? `${monthlyChatTokenRemaining.toLocaleString()}/${planLimits.chatTokensMonthly.toLocaleString()}`
                : '-'
            }
          />
        </Card>

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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  editButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  content: {
    padding: 20,
    gap: SPACING.md,
  },
  card: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 12,
  },
  infoLabel: {
    width: 90,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    color: COLORS.text,
  },

  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
});
