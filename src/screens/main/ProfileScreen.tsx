import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COLORS, RADIUS } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { AppIcon } from '../../components/ui/AppIcon';
import { useAppAlert } from '../../components/ui/AppAlert';
import { useUserStore } from '../../store/userStore';
import { supabase } from '../../services/supabaseClient';
import { getMonthlyAverageDietScoreRemote, getMonthlyMealPlanCountRemote, getMonthlyScanCountRemote, getSessionUserId, updateMyProfileAvatarRemote } from '../../services/userData';
import { pickAvatarFromLibrary } from '../../services/imagePicker';
import { ensurePhotoLibraryPermissionWithPrompt } from '../../services/permissions';
import { markUserInitiatedSignOut } from '../../services/authSignals';
import { GRADE_COLORS } from '../../types/user';
import { getPlanLabel, getPlanLimits, normalizePlanId } from '../../services/plans';
import { useTheme } from '../../theme/ThemeProvider';

function scoreToColor(score: number) {
  if (score >= 85) return GRADE_COLORS.very_good;
  if (score >= 70) return GRADE_COLORS.good;
  if (score >= 55) return GRADE_COLORS.neutral;
  if (score >= 40) return GRADE_COLORS.bad;
  return GRADE_COLORS.very_bad;
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { alert } = useAppAlert();
  const { colors, isDark } = useTheme();

  const profile = useUserStore(state => state.profile);
  const clearAllData = useUserStore(state => state.clearAllData);
  const setProfile = useUserStore(state => state.setProfile);

  const [monthlyScanCount, setMonthlyScanCount] = useState<number | null>(null);
  const [monthlyMealPlanCount, setMonthlyMealPlanCount] = useState<number | null>(null);
  const [monthlyDietScore, setMonthlyDietScore] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [isLoadingAvatar, setIsLoadingAvatar] = useState(false);

  const userName = profile?.nickname || profile?.name || '사용자';
  const plan = getPlanLabel(profile?.plan_id);
  const normalizedPlan = normalizePlanId(profile?.plan_id);
  const planLimits = getPlanLimits(profile?.plan_id);
  const isPremiumUser = normalizedPlan === 'plus' || normalizedPlan === 'pro' || normalizedPlan === 'master';
  const premiumBannerTitle =
    normalizedPlan === 'pro'
      ? 'Pro 플랜 사용 중'
      : normalizedPlan === 'plus'
        ? '프리미엄 사용 중'
        : normalizedPlan === 'master'
          ? 'Master 플랜 사용 중'
          : '프리미엄으로 업그레이드';
  const premiumBannerDesc =
    normalizedPlan === 'pro'
      ? '이미 프리미엄 Pro 플랜을 사용 중이에요.'
      : normalizedPlan === 'plus'
        ? '이미 프리미엄 Plus 플랜을 사용 중이에요.'
        : normalizedPlan === 'master'
          ? '모든 프리미엄 기능을 이미 사용할 수 있어요.'
          : 'Plus/Pro 플랜으로 월 제공량을 늘릴 수 있어요.';

  const usedThisMonth = typeof monthlyScanCount === 'number' ? monthlyScanCount : null;
  const remainingThisMonth = typeof usedThisMonth === 'number' ? Math.max(0, planLimits.monthlyScanLimit - usedThisMonth) : null;
  const usedMealPlanThisMonth = typeof monthlyMealPlanCount === 'number' ? monthlyMealPlanCount : null;
  const remainingMealPlanThisMonth =
    typeof usedMealPlanThisMonth === 'number' ? Math.max(0, planLimits.monthlyMealPlanLimit - usedMealPlanThisMonth) : null;
  const monthlyScoreColor = typeof monthlyDietScore === 'number' ? scoreToColor(monthlyDietScore) : colors.text;

  const avatarPath = profile?.avatarPath || null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!avatarPath) {
        if (mounted) setAvatarUrl(null);
        if (mounted) setIsLoadingAvatar(false);
        return;
      }
      try {
        if (!supabase) {
          if (mounted) setAvatarUrl(null);
          if (mounted) setIsLoadingAvatar(false);
          return;
        }

        if (mounted) setIsLoadingAvatar(true);
        const { data, error } = await supabase.storage.from('profile-avatars').createSignedUrl(avatarPath, 60 * 60 * 24 * 7);
        if (!mounted) return;
        if (error) {
          setAvatarUrl(null);
          return;
        }
        setAvatarUrl(data.signedUrl);
      } catch {
        if (mounted) setAvatarUrl(null);
      } finally {
        if (mounted) setIsLoadingAvatar(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [avatarPath]);

  const handleEditAvatar = useCallback(async () => {
    if (!profile?.id) {
      alert({ title: '로그인이 필요해요', message: '로그인 후 프로필 사진을 변경할 수 있습니다.' });
      return;
    }
    if (isUpdatingAvatar) return;

    try {
      const hasPhotoPermission = await ensurePhotoLibraryPermissionWithPrompt();
      if (!hasPhotoPermission) return;

      const picked = await pickAvatarFromLibrary();
      const localUri = String(picked?.uri ?? '').trim();
      if (!localUri) return;

      const base64 = typeof picked?.base64 === 'string' ? picked.base64 : null;

      setIsUpdatingAvatar(true);
      const result = await updateMyProfileAvatarRemote({
        localUri,
        base64,
        mime: picked?.type ?? null,
        previousAvatarPath: profile.avatarPath ?? null,
      });

      await setProfile(result.profile);
      setAvatarUrl(result.signedUrl ?? null);
    } catch (e: any) {
      const msg = e?.message || String(e);
      // 취소 케이스는 조용히 무시
      if (/cancel/i.test(msg)) return;
      alert({ title: '프로필 사진 변경 실패', message: msg });
    } finally {
      setIsUpdatingAvatar(false);
    }
  }, [alert, isUpdatingAvatar, profile?.avatarPath, profile?.id, setProfile]);

  useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const userId = await getSessionUserId().catch(() => null);
        if (!userId) {
          if (mounted) setMonthlyScanCount(null);
          if (mounted) setMonthlyMealPlanCount(null);
          if (mounted) setMonthlyDietScore(null);
          return;
        }
        const [n, dietScore] = await Promise.all([
          getMonthlyScanCountRemote().catch(() => null),
          getMonthlyAverageDietScoreRemote().catch(() => null),
        ]);
        const mealPlanN = await getMonthlyMealPlanCountRemote().catch(() => null);
        if (!mounted) return;
        if (typeof n === 'number') setMonthlyScanCount(n);
        if (typeof mealPlanN === 'number') setMonthlyMealPlanCount(mealPlanN);
        if (typeof dietScore === 'number') setMonthlyDietScore(dietScore);

        if (typeof n !== 'number' || typeof mealPlanN !== 'number') {
          retryTimer = setTimeout(() => {
            if (!mounted) return;
            void (async () => {
              const [retryScan, retryMealPlan, retryScore] = await Promise.all([
                getMonthlyScanCountRemote().catch(() => null),
                getMonthlyMealPlanCountRemote().catch(() => null),
                getMonthlyAverageDietScoreRemote().catch(() => null),
              ]);
              if (!mounted) return;
              if (typeof retryScan === 'number') setMonthlyScanCount(retryScan);
              if (typeof retryMealPlan === 'number') setMonthlyMealPlanCount(retryMealPlan);
              if (typeof retryScore === 'number') setMonthlyDietScore(retryScore);
            })();
          }, 900);
        }
      } catch {
        retryTimer = setTimeout(() => {
          if (!mounted) return;
          void (async () => {
            const [retryScan, retryMealPlan, retryScore] = await Promise.all([
              getMonthlyScanCountRemote().catch(() => null),
              getMonthlyMealPlanCountRemote().catch(() => null),
              getMonthlyAverageDietScoreRemote().catch(() => null),
            ]);
            if (!mounted) return;
            if (typeof retryScan === 'number') setMonthlyScanCount(retryScan);
            if (typeof retryMealPlan === 'number') setMonthlyMealPlanCount(retryMealPlan);
            if (typeof retryScore === 'number') setMonthlyDietScore(retryScore);
          })();
        }, 900);
      }
    })();
    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [profile?.id]);

  const menuItems = [
    { iconName: 'person', label: '내 정보', route: 'PersonalInfo' },
    { iconName: 'history', label: '히스토리', route: 'History' },
    { iconName: 'help-outline', label: '고객 센터', route: 'HelpCenter' },
  ];

  const handleLogout = () => {
    alert({
      title: '로그아웃',
      message: '정말 로그아웃 하시겠습니까?',
      actions: [
        { text: '취소', variant: 'outline' },
        {
          text: '로그아웃',
          variant: 'danger',
          onPress: async () => {
            try {
              markUserInitiatedSignOut();
              await supabase?.auth.signOut();
            } catch {
              // ignore
            }
            try {
              await clearAllData();
            } catch {
              // ignore
            }
            navigation.reset({
              index: 0,
              routes: [{ name: 'Login' as never }],
            });
          },
        },
      ],
    });
  };

  const quickActions = [
    {
      iconName: 'smart-toy' as const,
      title: '챗봇',
      description: '건강/식단 질문 바로 하기',
      onPress: () => navigation.navigate('Chat' as never),
    },
    {
      iconName: 'monitor-weight' as const,
      title: '오늘 몸무게',
      description: '체중/골격근량/체지방 기록',
      onPress: () => navigation.navigate('BodyTracker' as never),
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Profile Section */}
        <View style={styles.header}>
          <View style={styles.avatarBlock}>
            <TouchableOpacity
              style={[styles.avatarContainer, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}
              onPress={handleEditAvatar}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="프로필 이미지 추가"
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : isUpdatingAvatar || isLoadingAvatar ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <AppIcon name="add" size={30} color={colors.text} />
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.userInfo}>
              <Text style={[styles.userName, { color: colors.text }]}>{userName} 님</Text>
            <View style={styles.planBadge}>
              <Badge variant="secondary" text={plan + ' 플랜'} />
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => navigation.navigate('MonthlyDietScores' as never)}
                accessibilityRole="button"
                accessibilityLabel="월간 식단 점수 보기"
              >
                <Badge
                  variant="outline"
                  text={`이번 달 식단 점수 ${typeof monthlyDietScore === 'number' ? `${monthlyDietScore}점` : '-'}`}
                  textStyle={{ color: typeof monthlyDietScore === 'number' ? monthlyScoreColor : colors.textSecondary }}
                />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={[styles.settingsButton, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]} onPress={() => navigation.navigate('Settings' as never)}>
            <AppIcon name="settings" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.primary }]}>{typeof remainingThisMonth === 'number' ? String(remainingThisMonth) : '-'}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>이번 달 남은 스캔</Text>
          </Card>

          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              {typeof remainingMealPlanThisMonth === 'number' ? String(remainingMealPlanThisMonth) : '-'}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>이번 달 남은 식단 생성</Text>
          </Card>
        </View>

        <View style={styles.quickActionRow}>
          {quickActions.map((action) => (
            <TouchableOpacity
              key={action.title}
              activeOpacity={0.88}
              style={[styles.quickActionButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={action.onPress}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}>
                <AppIcon name={action.iconName} size={22} color={colors.primaryDark} />
              </View>
              <View style={styles.quickActionTextCol}>
                <Text style={[styles.quickActionTitle, { color: colors.text }]}>{action.title}</Text>
                <Text style={[styles.quickActionDesc, { color: colors.textSecondary }]}>{action.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Premium Banner */}
        <TouchableOpacity style={[
          styles.premiumBanner,
          { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.shadow },
          !isDark && styles.premiumBannerLight,
        ]} onPress={() => navigation.navigate((isPremiumUser ? 'Subscription' : 'UpgradePlan') as never)}>
          <View style={styles.premiumContent}>
            <View style={styles.premiumHeader}>
              <AppIcon name="workspace-premium" size={24} color={isPremiumUser ? colors.primary : colors.warningDark} />
              <Text style={[styles.premiumTitle, { color: colors.text }]}>{premiumBannerTitle}</Text>
            </View>
              <Text style={[styles.premiumDesc, { color: colors.textSecondary }]}>{premiumBannerDesc}</Text>
          </View>
          <View style={styles.premiumRightCol}>
            {isPremiumUser ? <Badge variant="secondary" text="이미 사용 중" /> : null}
            <AppIcon name="chevron-right" size={26} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>

        {/* Menu Items */}
        <View style={[styles.menuContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.menuItem,
                { borderBottomColor: colors.border },
                index === menuItems.length - 1 && styles.menuItemLast,
              ]}
              onPress={() => {
                if (item.route === 'PersonalInfo') {
                  navigation.navigate('PersonalInfo' as never);
                  return;
                }
                if (item.route === 'History') {
                  navigation.navigate('History' as never);
                  return;
                }
                if (item.route === 'Privacy') {
                  navigation.navigate('Privacy' as never);
                  return;
                }
                if (item.route === 'HelpCenter') {
                  navigation.navigate('HelpCenter' as never);
                  return;
                }
                alert({ title: item.label, message: '현재 버전에서는 준비 중인 기능입니다.' });
              }}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}>
                  <AppIcon name={item.iconName} size={20} color={colors.text} />
                </View>
                <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
              </View>
              <AppIcon name="chevron-right" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <AppIcon name="logout" size={20} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>로그아웃</Text>
        </TouchableOpacity>

        <Text style={[styles.versionText, { color: colors.textSecondary }]}>버전 1.0.0</Text>
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
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarBlock: {
    alignItems: 'center',
    marginRight: 16,
  },
  avatarContainer: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  avatarHint: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    minWidth: '48%',
    alignItems: 'center',
    padding: 18,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  quickActionButton: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  quickActionTextCol: {
    flex: 1,
  },
  quickActionTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  quickActionDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  premiumBanner: {
    backgroundColor: COLORS.primaryDark,
    borderRadius: RADIUS.lg,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  premiumBannerLight: {
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  premiumContent: {
    flex: 1,
  },
  premiumRightCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  premiumHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  premiumTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: 'white',
  },
  premiumDesc: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  menuContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.destructive,
  },
  versionText: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 20,
  },
});
