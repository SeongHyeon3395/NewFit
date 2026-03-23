import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze, enableScreens } from 'react-native-screens';
import RootNavigator from './src/navigation/RootNavigator';
import { AppAlertProvider } from './src/components/ui/AppAlert';
import { AppToastProvider } from './src/components/ui/AppToast';
import { initTelemetry } from './src/services/telemetry';
import { startSyncQueueListener } from './src/services/syncQueue';
import { getSessionUserId } from './src/services/userData';
import { runWhenIdle } from './src/services/idleTask';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

enableScreens(true);
enableFreeze(true);

export default function App() {
  useEffect(() => {
    const task = runWhenIdle(() => {
      initTelemetry();
      startSyncQueueListener(() => getSessionUserId().catch(() => null));
    }, 250);

    return () => {
      task.cancel();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { colors, isDark } = useTheme();

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
        translucent={false}
      />
      <AppAlertProvider>
        <AppToastProvider>
          <RootNavigator />
        </AppToastProvider>
      </AppAlertProvider>
    </>
  );
}