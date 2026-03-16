import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { AppIcon } from '../../components/ui/AppIcon';
import { useAppAlert } from '../../components/ui/AppAlert';
import { useUserStore } from '../../store/userStore';
import { getMonthlyMealPlanCountRemote, getMonthlyScanCountRemote, getMonthlyChatTokenStatusRemote } from '../../services/userData';
import { getPlanLabel, getPlanLimits, normalizePlanId } from '../../services/plans';
import { retryAsync } from '../../services/retry';
import { useTheme } from '../../theme/ThemeProvider';

export default function SubscriptionScreen() {
  const navigation = useNavigation<any>();
  const { alert } = useAppAlert();
  const { colors } = useTheme();
  const profile = useUserStore((s) => s.profile);
  const updateProfile = useUserStore((s) => s.updateProfile);

  const [scanUsed, setScanUsed] = useState<number | null>(null);
  const [mealUsed, setMealUsed] = useState<number | null>(null);
  const [chatRemaining, setChatRemaining] = useState<number | null>(null);

  const planId = normalizePlanId(profile?.plan_id);
  const limits = useMemo(() => getPlanLimits(planId), [planId]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      (async () => {
        try {
          const [scan, meal, chat] = await Promise.all([
            retryAsync(() => getMonthlyScanCountRemote(), { retries: 1, delayMs: 700 }).catch(() => null),
            retryAsync(() => getMonthlyMealPlanCountRemote(), { retries: 1, delayMs: 700 }).catch(() => null),
            retryAsync(() => getMonthlyChatTokenStatusRemote(), { retries: 1, delayMs: 700 }).catch(() => null),
          ]);
          if (!alive) return;
          setScanUsed((prev) => (typeof scan === 'number' ? scan : prev));
          setMealUsed((prev) => (typeof meal === 'number' ? meal : prev));
          setChatRemaining((prev) => (typeof chat?.remaining === 'number' ? chat.remaining : prev));

          if (typeof scan !== 'number' || typeof meal !== 'number' || typeof chat?.remaining !== 'number') {
            retryTimer = setTimeout(() => {
              if (!alive) return;
              void (async () => {
                const [retryScan, retryMeal, retryChat] = await Promise.all([
                  getMonthlyScanCountRemote().catch(() => null),
                  getMonthlyMealPlanCountRemote().catch(() => null),
                  getMonthlyChatTokenStatusRemote().catch(() => null),
                ]);
                if (!alive) return;
                if (typeof retryScan === 'number') setScanUsed(retryScan);
                if (typeof retryMeal === 'number') setMealUsed(retryMeal);
                if (typeof retryChat?.remaining === 'number') setChatRemaining(retryChat.remaining);
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
              if (typeof retryScan === 'number') setScanUsed(retryScan);
              if (typeof retryMeal === 'number') setMealUsed(retryMeal);
              if (typeof retryChat?.remaining === 'number') setChatRemaining(retryChat.remaining);
            })();
          }, 900);
        }
      })();
      return () => {
        alive = false;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }, [])
  );

  const handleCancelSubscription = () => {
    if (planId === 'free') {
      alert({ title: '안내', message: '이미 Free 플랜을 사용 중이에요.' });
      return;
    }

    alert({
      title: '구독 취소',
      message: '다음 달부터 Free 플랜으로 전환됩니다. 지금 테스트 모드에서는 즉시 Free로 전환돼요. 계속할까요?',
      actions: [
        { text: '닫기', variant: 'outline' },
        {
          text: '구독 취소',
          variant: 'danger',
          onPress: async () => {
            await updateProfile({ plan_id: 'free' as any });
            const chat = await retryAsync(() => getMonthlyChatTokenStatusRemote(), { retries: 1, delayMs: 700 }).catch(() => null);
            setChatRemaining(typeof chat?.remaining === 'number' ? chat.remaining : null);
            alert({ title: '완료', message: 'Free 플랜으로 전환되었어요.' });
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppIcon name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>구독 관리</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Text style={[styles.title, { color: colors.text }]}>현재 플랜</Text>
          <Text style={[styles.planText, { color: colors.primary }]}>{getPlanLabel(planId)} 플랜</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>이번 달 사용량 기준으로 남은 제공량을 보여드려요.</Text>

          <View style={[styles.kvRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.kvKey, { color: colors.textSecondary }]}>남은 스캔</Text>
            <Text style={[styles.kvValue, { color: colors.text }]}>{typeof scanUsed === 'number' ? `${Math.max(0, limits.monthlyScanLimit - scanUsed)}/${limits.monthlyScanLimit}` : '-'}</Text>
          </View>
          <View style={[styles.kvRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.kvKey, { color: colors.textSecondary }]}>남은 식단 생성</Text>
            <Text style={[styles.kvValue, { color: colors.text }]}>{typeof mealUsed === 'number' ? `${Math.max(0, limits.monthlyMealPlanLimit - mealUsed)}/${limits.monthlyMealPlanLimit}` : '-'}</Text>
          </View>
          <View style={[styles.kvRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.kvKey, { color: colors.textSecondary }]}>남은 챗봇 토큰</Text>
            <Text style={[styles.kvValue, { color: colors.text }]}>{typeof chatRemaining === 'number' ? `${chatRemaining.toLocaleString()}/${limits.chatTokensMonthly.toLocaleString()}` : '-'}</Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.title, { color: colors.text }]}>결제 / 플랜</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>결제 연동 전에는 테스트 플랜 변경으로 동작합니다.</Text>
          <View style={styles.actionList}>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonPrimary]}
              onPress={() => navigation.navigate('UpgradePlan')}
              activeOpacity={0.9}
            >
              <View style={styles.actionLeft}>
                <View style={[styles.actionIcon, styles.actionIconPrimary]}>
                  <AppIcon name="workspace-premium" size={18} color="#FFFFFF" />
                </View>
                <View>
                  <Text style={styles.actionTitlePrimary}>프리미엄으로 업그레이드</Text>
                  <Text style={styles.actionSubtitlePrimary}>Plus / Pro 플랜 선택</Text>
                </View>
              </View>
              <AppIcon name="chevron-right" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.actionButtonDanger,
                { backgroundColor: colors.red50, borderColor: colors.red200 },
                planId === 'free' && styles.actionButtonDisabled,
              ]}
              onPress={handleCancelSubscription}
              disabled={planId === 'free'}
              activeOpacity={0.9}
            >
              <View style={styles.actionLeft}>
                <View style={[styles.actionIcon, styles.actionIconDanger]}>
                  <AppIcon name="cancel" size={18} color={colors.danger} />
                </View>
                <View>
                  <Text style={[styles.actionTitle, { color: colors.text }]}>구독 취소</Text>
                  <Text style={[styles.actionSubtitle, { color: colors.textSecondary }]}>현재 플랜 해지 후 Free로 전환</Text>
                </View>
              </View>
              <AppIcon name="chevron-right" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonOutline, { backgroundColor: colors.backgroundGray, borderColor: colors.border }, styles.actionButtonDisabled]}
              onPress={() => {}}
              disabled
              activeOpacity={0.9}
            >
              <View style={styles.actionLeft}>
                <View style={[styles.actionIcon, styles.actionIconOutline]}>
                  <AppIcon name="restart-alt" size={18} color={colors.primary} />
                </View>
                <View>
                  <Text style={[styles.actionTitle, { color: colors.text }]}>구독 복원</Text>
                  <Text style={[styles.actionSubtitle, { color: colors.textSecondary }]}>스토어 연동 후 제공 예정</Text>
                </View>
              </View>
              <AppIcon name="chevron-right" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
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
  content: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  card: { padding: SPACING.md, borderRadius: RADIUS.md },
  title: { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  planText: { fontSize: 22, fontWeight: '800', color: COLORS.primary, marginBottom: 4 },
  desc: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  kvKey: { fontSize: 14, color: COLORS.textSecondary },
  kvValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  actionList: {
    marginTop: 8,
    gap: 10,
  },
  actionButton: {
    minHeight: 58,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  actionButtonPrimary: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  actionButtonDanger: {
    backgroundColor: COLORS.red50,
    borderColor: COLORS.red200,
  },
  actionButtonOutline: {
    backgroundColor: COLORS.backgroundGray,
    borderColor: COLORS.border,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconPrimary: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  actionIconDanger: {
    backgroundColor: COLORS.red100,
  },
  actionIconOutline: {
    backgroundColor: COLORS.blue50,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  actionTitlePrimary: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  actionSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  actionSubtitlePrimary: {
    marginTop: 2,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
});
