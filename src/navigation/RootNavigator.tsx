import React, { useEffect, useMemo, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import NetInfo from '@react-native-community/netinfo';
import { RootStackParamList } from './types';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { fetchMyAppUser } from '../services/userData';
import { retryAsync } from '../services/retry';
import { useUserStore } from '../store/userStore';
import { useAppAlert } from '../components/ui/AppAlert';
import { SplashOverlay } from '../components/SplashOverlay';
import { consumeUserInitiatedSignOut } from '../services/authSignals';

// Screens
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import MainTabNavigator from './MainTabNavigator';
import VerifyScreen from '../screens/scan/VerifyScreen';
import ResultScreen from '../screens/scan/ResultScreen';
import CameraScreen from '../screens/scan/CameraScreen';
import EditScreen from '../screens/scan/EditScreen.tsx';
import HomeScreen from '../screens/home/HomeScreen'; // Keep for legacy if needed, or remove
import FoodResultScreen from '../screens/home/FoodResultScreen';
import PrivacySecurityScreen from '../screens/main/PrivacySecurityScreen';
import TermsScreen from '../screens/main/TermsScreen';
import PrivacyPolicyScreen from '../screens/main/PrivacyPolicyScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import PersonalInfoScreen from '../screens/main/PersonalInfoScreen';
import MonthlyDietScoresScreen from '../screens/main/MonthlyDietScoresScreen';
import EditPersonalInfoScreen from '../screens/main/EditPersonalInfoScreen.tsx';
import EditAllergensScreen from '../screens/main/EditAllergensScreen.tsx';
import MealDetailScreen from '../screens/main/MealDetailScreen';
import NotificationSettingsScreen from '../screens/main/NotificationSettingsScreen';
import MealPlanDetailScreen from '../screens/main/MealPlanDetailScreen';
import HistoryScreen from '../screens/main/HistoryScreen';
import SubscriptionScreen from '../screens/main/SubscriptionScreen';
import HelpCenterScreen from '../screens/main/HelpCenterScreen';
import UpgradePlanScreen from '../screens/main/UpgradePlanScreen';
import ChatScreen from '../screens/main/ChatScreen';
import BodyTrackerScreen from '../screens/main/BodyTrackerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => {
      clearTimeout(t);
      resolve(v);
    }).catch(e => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function isLikelyRefreshTokenExpiredError(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  // Supabase GoTrue/clients can surface various messages depending on platform/version.
  return (
    msg.includes('invalid refresh token') ||
    msg.includes('refresh token not found') ||
    msg.includes('invalid_grant') ||
    msg.includes('jwt expired') ||
    msg.includes('session expired') ||
    msg.includes('refresh_token') && msg.includes('expired')
  );
}

export default function RootNavigator() {
  const setProfile = useUserStore(state => state.setProfile);
  const clearAllData = useUserStore(state => state.clearAllData);
  const { alert } = useAppAlert();
  const [booting, setBooting] = useState(true);
  const [pendingReset, setPendingReset] = useState<null | { name: keyof RootStackParamList; params?: any }>(null);
  const navigationRef = useMemo(() => createNavigationContainerRef<RootStackParamList>(), []);
  const [navReady, setNavReady] = useState(false);
  const [sessionExpiredNoticeShown, setSessionExpiredNoticeShown] = useState(false);
  const [networkNoticeShown, setNetworkNoticeShown] = useState(false);

  const resetTo = (name: keyof RootStackParamList, params?: any) => {
    if (navigationRef.isReady()) {
      navigationRef.resetRoot({ index: 0, routes: [{ name: name as any, params }] });
      return;
    }
    setPendingReset({ name, params });
  };

  useEffect(() => {
    let mounted = true;

    const notifyNetworkIssueOnce = async () => {
      if (!mounted || networkNoticeShown) return;

      try {
        const state = await NetInfo.fetch();
        const isOffline = state.isConnected === false || state.isInternetReachable === false;
        if (!isOffline) return;

        setNetworkNoticeShown(true);
        alert({
          title: '네트워크 연결 확인',
          message: '현재 서버에 연결되지 않아 로그인과 기록 동기화가 제한될 수 있어요. 앱을 사용하기 전에 Wi‑Fi 또는 모바일 데이터 연결을 확인해주세요.',
        });
      } catch {
        // ignore
      }
    };

    const notifySessionExpiredAndGoLogin = () => {
      if (!mounted) return;
      if (sessionExpiredNoticeShown) {
        resetTo('Login');
        return;
      }

      setSessionExpiredNoticeShown(true);
      resetTo('Login');
      alert({
        title: '세션 만료',
        message: '장시간 로그인 하지 않아 로그아웃되었습니다. 다시 로그인해주세요.',
      });
    };

    (async () => {
      try {
        await notifyNetworkIssueOnce();

        if (!isSupabaseConfigured || !supabase) {
          if (mounted) resetTo('Login');
          return;
        }

        // 세션 복원(필요 시 refresh 시도)
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        let session = data.session;
        if (session) {
          try {
            const refreshed = await withTimeout(supabase.auth.refreshSession(), 2000);
            const refreshError = (refreshed as any)?.error;
            if (refreshError) {
              if (isLikelyRefreshTokenExpiredError(refreshError)) {
                try {
                  await clearAllData();
                } catch {
                  // ignore
                }
                notifySessionExpiredAndGoLogin();
                return;
              }
            }
            if ((refreshed as any)?.data?.session) session = (refreshed as any).data.session;
          } catch (e) {
            // timeout/네트워크 등은 즉시 로그아웃하지 않음
            await notifyNetworkIssueOnce();
            if (isLikelyRefreshTokenExpiredError(e)) {
              try {
                await clearAllData();
              } catch {
                // ignore
              }
              notifySessionExpiredAndGoLogin();
              return;
            }
          }
        }
        if (!session) {
          await notifyNetworkIssueOnce();
          if (mounted) resetTo('Login');
          return;
        }

        // 세션이 있으면 프로필도 미리 로드
        try {
          const remoteProfile = await retryAsync(
            () => withTimeout(fetchMyAppUser(), 1500),
            { retries: 1, delayMs: 700 }
          );
          await setProfile(remoteProfile as any);
          if (mounted) {
            if (remoteProfile?.onboardingCompleted) {
              resetTo('MainTab', { screen: 'Scan' });
            } else {
              resetTo('Onboarding', { initialStep: 1 });
            }
          }
        } catch {
          // 프로필 로드가 실패해도 세션은 살아있으므로 메인으로는 진입
          if (mounted) resetTo('MainTab', { screen: 'Scan' });
        }
      } catch {
        await notifyNetworkIssueOnce();
        if (mounted) resetTo('Login');
      } finally {
        if (mounted) setBooting(false);
      }
    })();

    const sub = supabase?.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (!session) {
        // 수동 로그아웃이면 안내 문구 없이 로그인으로
        const userInitiated = consumeUserInitiatedSignOut();
        try {
          await clearAllData();
        } catch {
          // ignore
        }

        if (userInitiated) {
          resetTo('Login');
          alert({
            title: '로그아웃',
            message: '로그아웃 되었습니다.',
          });
          return;
        }

        // refresh token 만료/세션 만료로 추정되는 경우 안내 후 로그인으로
        const ev = String(event);
        if (ev === 'TOKEN_REFRESH_FAILED' || ev === 'SIGNED_OUT') {
          notifySessionExpiredAndGoLogin();
          return;
        }

        resetTo('Login');
        return;
      }

      try {
        const remoteProfile = await retryAsync(
          () => withTimeout(fetchMyAppUser(), 1500),
          { retries: 1, delayMs: 700 }
        );
        await setProfile(remoteProfile as any);
        if (remoteProfile?.onboardingCompleted) {
          resetTo('MainTab', { screen: 'Scan' });
        } else {
          resetTo('Onboarding', { initialStep: 1 });
        }
      } catch {
        resetTo('MainTab', { screen: 'Scan' });
      }
    });

    return () => {
      mounted = false;
      sub?.data?.subscription?.unsubscribe?.();
    };
  }, [alert, clearAllData, networkNoticeShown, sessionExpiredNoticeShown, setProfile]);

  return (
    <>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          setNavReady(true);
          if (pendingReset) {
            navigationRef.resetRoot({ index: 0, routes: [{ name: pendingReset.name as any, params: pendingReset.params }] });
            setPendingReset(null);
          }
        }}
      >
        <Stack.Navigator 
          initialRouteName="Login"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Signup" component={SignupScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="MainTab" component={MainTabNavigator} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="BodyTracker" component={BodyTrackerScreen} />
          <Stack.Screen name="History" component={HistoryScreen} />
          
          {/* Scan Flow */}
          <Stack.Screen name="Camera" component={CameraScreen} />
          <Stack.Screen name="Edit" component={EditScreen} />
          <Stack.Screen name="Verify" component={VerifyScreen} />
          <Stack.Screen name="Result" component={ResultScreen} />

          {/* Meal */}
          <Stack.Screen name="MealDetail" component={MealDetailScreen} />
          <Stack.Screen name="MealPlanDetail" component={MealPlanDetailScreen} />

          {/* Settings */}
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
          <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
          <Stack.Screen name="EditPersonalInfo" component={EditPersonalInfoScreen} />
          <Stack.Screen name="EditAllergens" component={EditAllergensScreen} />
          <Stack.Screen name="MonthlyDietScores" component={MonthlyDietScoresScreen} />
          <Stack.Screen name="Privacy" component={PrivacySecurityScreen} />
          <Stack.Screen name="Terms" component={TermsScreen} />
          <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} />
          <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
          <Stack.Screen name="UpgradePlan" component={UpgradePlanScreen} />

          {/* Legacy / Fallback */}
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen
            name="FoodResult"
            component={FoodResultScreen}
            options={{
              headerShown: true,
              title: '분석 결과',
              headerBackTitle: '돌아가기',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>

      {(booting || !navReady || pendingReset != null) && <SplashOverlay />}
    </>
  );
}
