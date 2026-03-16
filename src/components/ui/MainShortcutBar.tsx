import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SPACING } from '../../constants/colors';
import { useTheme } from '../../theme/ThemeProvider';
import { AppIcon } from './AppIcon';

export const MAIN_SHORTCUT_BAR_HEIGHT = 64;
export const MAIN_SHORTCUT_BAR_TOP_PADDING = 8;
export const MAIN_SHORTCUT_BAR_BOTTOM_PADDING = 8;

const ITEMS = [
  { key: 'Scan', label: '스캔', icon: 'document-scanner' as const },
  { key: 'Meal', label: '식단', icon: 'restaurant' as const },
  { key: 'Calendar', label: '캘린더', icon: 'calendar-today' as const },
  { key: 'Profile', label: '프로필', icon: 'person' as const },
] as const;

export function MainShortcutBar() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const goToMainTab = (screen: (typeof ITEMS)[number]['key']) => {
    const parentNav = navigation.getParent?.();
    const rootNav = parentNav?.getParent?.() ?? parentNav ?? navigation;

    rootNav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTab', params: { screen } }],
      })
    );
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: MAIN_SHORTCUT_BAR_HEIGHT + insets.bottom,
          paddingTop: MAIN_SHORTCUT_BAR_TOP_PADDING,
          paddingBottom: MAIN_SHORTCUT_BAR_BOTTOM_PADDING + insets.bottom,
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: isDark ? 0.08 : 0,
          shadowRadius: isDark ? 16 : 0,
          elevation: isDark ? 10 : 0,
        },
      ]}
    >
      {ITEMS.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={styles.item}
          onPress={() => goToMainTab(item.key)}
          accessibilityRole="button"
          accessibilityLabel={`${item.label} 탭으로 이동`}
        >
          <AppIcon name={item.icon} size={24} color={colors.textGray} />
          <Text style={[styles.label, { color: colors.textGray }]}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingHorizontal: 0,
  },
  item: {
    flex: 1,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});