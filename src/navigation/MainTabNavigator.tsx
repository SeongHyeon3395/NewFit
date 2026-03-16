import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainTabParamList } from './types';
import { AppIcon } from '../components/ui/AppIcon';
import { MAIN_SHORTCUT_BAR_BOTTOM_PADDING, MAIN_SHORTCUT_BAR_HEIGHT, MAIN_SHORTCUT_BAR_TOP_PADDING } from '../components/ui/MainShortcutBar';
import { useTheme } from '../theme/ThemeProvider';

// Screens
import ScanScreen from '../screens/main/ScanScreen';
import MealScreen from '../screens/main/MealScreen';
import CalendarScreen from '../screens/main/CalendarScreen.tsx';
import ProfileScreen from '../screens/main/ProfileScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textGray,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
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
        tabBarItemStyle: {
          paddingVertical: 2,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      }}
    >
      <Tab.Screen
        name="Scan"
        component={ScanScreen}
        options={{
          tabBarLabel: '스캔',
          tabBarIcon: ({ color }) => <AppIcon name="document-scanner" color={color} size={24} />,
        }}
      />
      <Tab.Screen
        name="Meal"
        component={MealScreen}
        options={{
          tabBarLabel: '식단',
          tabBarIcon: ({ color }) => <AppIcon name="restaurant" color={color} size={24} />,
        }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{
          tabBarLabel: '캘린더',
          tabBarIcon: ({ color }) => <AppIcon name="calendar-today" color={color} size={24} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: '프로필',
          tabBarIcon: ({ color }) => <AppIcon name="person" color={color} size={24} />,
        }}
      />
    </Tab.Navigator>
  );
}
