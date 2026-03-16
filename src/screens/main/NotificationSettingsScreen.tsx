import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { COLORS, SPACING, RADIUS } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { AppIcon } from '../../components/ui/AppIcon';
import { getSessionUserId, fetchMyNotificationSettingsRemote, upsertMyNotificationSettingsRemote } from '../../services/userData';
import { useAppAlert } from '../../components/ui/AppAlert';
import { retryAsync } from '../../services/retry';
import { useTheme } from '../../theme/ThemeProvider';

type NotificationSettings = {
  enabled: boolean;
  mealReminder: boolean;
  weeklySummary: boolean;
  tips: boolean;
};

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  mealReminder: false,
  weeklySummary: false,
  tips: false,
};

type ToggleRowProps = {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
};

function ToggleRow({ title, description, value, onValueChange, disabled }: ToggleRowProps) {
  const { colors } = useTheme();
  const trackColor = useMemo(
    () => ({ false: colors.border, true: colors.primary }),
    [colors.border, colors.primary]
  );

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }, disabled && styles.disabledText]}>{title}</Text>
        {description ? (
          <Text style={[styles.rowDesc, { color: colors.textSecondary }, disabled && styles.disabledText]}>{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={trackColor}
        thumbColor={value ? 'white' : 'white'}
      />
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { alert } = useAppAlert();
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const persist = useCallback(async (next: NotificationSettings) => {
    if (!userId) {
      alert({
        title: '로그인 필요',
        message: '알림 설정은 로그인한 계정에만 저장돼요. 다시 로그인 후 시도해주세요.',
      });
      return;
    }

    const previous = settings;
    setSettings(next);
    setIsSaving(true);
    try {
      await retryAsync(
        () => upsertMyNotificationSettingsRemote({
          enabled: next.enabled,
          meal_reminder: next.mealReminder,
          weekly_summary: next.weeklySummary,
          tips: next.tips,
        }),
        { retries: 1, delayMs: 700 }
      );
    } catch (e) {
      console.error('Failed to save notification settings', e);
      setSettings(previous);
      alert({
        title: '저장 실패',
        message: '알림 설정 저장이 잠시 실패했어요. 네트워크를 확인한 뒤 다시 시도해주세요.',
      });
    } finally {
      setIsSaving(false);
    }
  }, [alert, settings, userId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const uid = await getSessionUserId().catch(() => null);
        if (!mounted) return;
        setUserId(uid);

        if (!uid) {
          setSettings(DEFAULT_SETTINGS);
          return;
        }

        const remote = await retryAsync(() => fetchMyNotificationSettingsRemote(), { retries: 1, delayMs: 700 });
        if (!mounted) return;
        setSettings({
          enabled: Boolean(remote?.enabled),
          mealReminder: Boolean(remote?.meal_reminder),
          weeklySummary: Boolean(remote?.weekly_summary),
          tips: Boolean(remote?.tips),
        });
      } catch (e) {
        console.error('Failed to load notification settings', e);
      } finally {
        if (mounted) setLoaded(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const setEnabled = useCallback(
    (nextEnabled: boolean) => {
      const next: NotificationSettings = {
        ...settings,
        enabled: nextEnabled,
      };
      void persist(next);
    },
    [persist, settings]
  );

  const setField = useCallback(
    (key: keyof Omit<NotificationSettings, 'enabled'>, value: boolean) => {
      const next: NotificationSettings = {
        ...settings,
        [key]: value,
      };
      void persist(next);
    },
    [persist, settings]
  );

  const subDisabled = !settings.enabled;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppIcon name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>알림 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>전체</Text>
            <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>원할 때만 켜고 끌 수 있어요.</Text>
          </View>
          <ToggleRow
            title="알림 받기"
            description={loaded ? '식단 기록과 요약 알림을 받을지 선택해요.' : '설정을 불러오는 중…'}
            value={settings.enabled}
            onValueChange={setEnabled}
            disabled={!userId || isSaving}
          />
        </Card>

        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>식단/기록</Text>
            <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>스캔하고 기록하는 습관을 도와요.</Text>
          </View>
          <ToggleRow
            title="식사 기록 리마인더"
            description="하루에 한 번, 식단 기록을 잊지 않게 알려줘요."
            value={settings.mealReminder}
            onValueChange={(v) => setField('mealReminder', v)}
            disabled={subDisabled || !userId || isSaving}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ToggleRow
            title="주간 요약"
            description="이번 주 기록을 한 번에 요약해서 알려줘요."
            value={settings.weeklySummary}
            onValueChange={(v) => setField('weeklySummary', v)}
            disabled={subDisabled || !userId || isSaving}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <ToggleRow
            title="건강 팁"
            description="목표(다이어트/유지 등)에 맞는 간단한 팁을 보내줘요."
            value={settings.tips}
            onValueChange={(v) => setField('tips', v)}
            disabled={subDisabled || !userId || isSaving}
          />
        </Card>

        <Text style={[styles.note, { color: colors.textSecondary }]}>
          실제 푸시 알림(시간 지정/전송)은 추후 서버/OS 권한 설정과 함께 연결돼요. 지금은 앱 내 설정을 저장해두는 화면이에요.
        </Text>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  card: {
    paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  sectionHeader: {
    paddingHorizontal: SPACING.md,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
  },
  sectionDesc: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    gap: 12,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  rowDesc: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginLeft: SPACING.md,
  },
  note: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
    paddingHorizontal: 2,
  },
  disabledText: {
    color: COLORS.textSecondary,
    opacity: 0.6,
  },
});
