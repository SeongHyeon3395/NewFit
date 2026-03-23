import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  StatusBar,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Linking,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { login as kakaoNativeLogin } from '@react-native-seoul/kakao-login';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useUserStore } from '../../store/userStore';
import { COLORS } from '../../constants/colors';
import { Button } from '../../components/ui/Button';
import { useAppAlert } from '../../components/ui/AppAlert';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { GOOGLE_WEB_CLIENT_ID, KAKAO_NATIVE_APP_KEY } from '../../config';
import { fetchMyAppUser } from '../../services/userData';
import { retryAsync } from '../../services/retry';
import { AppIcon } from '../../components/ui/AppIcon';

function getDeviceLocaleTag(): string {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    if (typeof tag === 'string' && tag.trim()) return tag;
  } catch {
    // ignore
  }
  try {
    const navLang = (globalThis as any)?.navigator?.language;
    if (typeof navLang === 'string' && navLang.trim()) return navLang;
  } catch {
    // ignore
  }
  return '';
}

function isKoreanLocale() {
  const tag = getDeviceLocaleTag().toLowerCase();
  return tag === 'ko' || tag.startsWith('ko-');
}

function getLoginErrorMessage(err: any): string {
  const raw = String(err?.message ?? err ?? '').trim();
  const msg = raw.toLowerCase();

  // Supabase: wrong id/password
  if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
    return '아이디 또는 비밀번호가 올바르지 않습니다.';
  }

  // Optional/common auth cases
  if (msg.includes('email not confirmed') || msg.includes('email confirmation')) {
    return '이메일 인증이 필요합니다. 이메일을 확인해주세요.';
  }

  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return '요청이 너무 많아요. 잠시 후 다시 시도해주세요.';
  }

  if (msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch')) {
    return '네트워크 문제로 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }

  return raw || '로그인에 실패했습니다. 아이디/비밀번호를 확인 후 다시 시도해주세요.';
}

function isInvalidCredentialError(err: any): boolean {
  const raw = String(err?.message ?? err ?? '').toLowerCase();
  return raw.includes('invalid login credentials') || raw.includes('invalid_grant');
}

function getProviderHintMessage(providerHint: string | null | undefined): string | null {
  const p = String(providerHint ?? '').toLowerCase();
  if (p === 'google') return '이 계정은 Google로 가입되었습니다. Google로 로그인해주세요.';
  if (p === 'kakao') return '이 계정은 카카오로 가입되었습니다. 카카오로 로그인해주세요.';
  if (p === 'social') return '이 계정은 소셜 로그인으로 가입되었습니다. Google 또는 카카오로 로그인해주세요.';
  return null;
}

function GoogleMark({ size = 18 }: { size?: number }) {
  // 브랜드 에셋을 직접 포함하지 않고, 앱 팔레트로 "구글 느낌"을 맞춘 단순 마크입니다.
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 18 18">
      {/* Blue */}
      <Path d="M9 1.6c2.06 0 3.44.9 4.22 1.66l-1.72 1.66C11.02 4.5 10.2 4.1 9 4.1c-1.98 0-3.66 1.33-4.23 3.12H2.58V4.55C3.9 2.76 6.24 1.6 9 1.6z" fill={COLORS.primary} />
      {/* Red */}
      <Path d="M4.77 7.22A4.96 4.96 0 0 0 4.5 9c0 .62.1 1.21.27 1.78l-2.19 1.67A8.02 8.02 0 0 1 1.8 9c0-1.39.35-2.7.78-3.88l2.19 2.1z" fill={COLORS.danger} />
      {/* Yellow */}
      <Path d="M9 16.4c-2.76 0-5.1-1.16-6.42-2.95l2.19-1.67c.57 1.79 2.25 3.12 4.23 3.12 1.08 0 2.03-.35 2.78-.96l2.05 1.58C12.68 15.63 11.06 16.4 9 16.4z" fill={COLORS.warning} />
      {/* Green */}
      <Path d="M16.2 9c0-.55-.07-1.08-.2-1.58H9v3.02h3.98c-.2.99-.77 1.82-1.63 2.4l2.05 1.58C15.07 13.35 16.2 11.36 16.2 9z" fill={COLORS.success} />
    </Svg>
  );
}

function KakaoMark({ size = 18 }: { size?: number }) {
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Path
        d="M12 2.5c-5.52 0-10 3.58-10 8 0 2.88 1.9 5.41 4.76 6.81l-.93 3.58c-.08.32.28.58.56.39l4.2-2.8c.46.06.93.09 1.41.09 5.52 0 10-3.58 10-8s-4.48-8-10-8z"
        fill="#3A1D1D"
      />
      <Path d="M8.3 9.5h1.6v3h1.8v1.4H8.3zM13 9.5h1.6v4.4H13z" fill="#FEE500" />
    </Svg>
  );
}

function parseOAuthCallback(url: string) {
  const parseParams = (input: string) => {
    const out: Record<string, string> = {};
    const raw = String(input || '').replace(/^#/, '').replace(/^\?/, '').trim();
    if (!raw) return out;

    raw.split('&').forEach(pair => {
      const [k, ...rest] = pair.split('=');
      if (!k) return;
      const value = rest.join('=');
      out[decodeURIComponent(k)] = decodeURIComponent(value || '');
    });
    return out;
  };

  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const queryRaw = queryIndex >= 0
    ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
    : '';
  const hashRaw = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';

  const query = parseParams(queryRaw);
  const hash = parseParams(hashRaw);
  const read = (key: string) => query[key] || hash[key] || null;

  return {
    code: read('code'),
    accessToken: read('access_token'),
    refreshToken: read('refresh_token'),
    error: read('error'),
    errorDescription: read('error_description'),
  };
}

function getOAuthErrorMessage(err: any): string {
  const raw = String(err?.message ?? err ?? '').trim();
  const msg = raw.toLowerCase();

  if (msg.includes('cancel') || msg.includes('dismiss')) {
    return '로그인이 취소되었습니다.';
  }
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch')) {
    return '네트워크 문제로 소셜 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }

  return raw || '소셜 로그인 처리에 실패했습니다.';
}

function getKakaoErrorMessage(err: any): string {
  const raw = String(err?.message ?? err ?? '').trim();
  const msg = raw.toLowerCase();

  if (msg.includes('cancel')) return '카카오 로그인이 취소되었습니다.';
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('failed')) {
    return '네트워크 문제로 카카오 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }

  return raw || '카카오 로그인 처리에 실패했습니다.';
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

export default function LoginScreen() {
  const navigation = useNavigation<NavigationProp>();
  const profile = useUserStore(state => state.profile);
  const setProfile = useUserStore(state => state.setProfile);
  const { alert } = useAppAlert();

  const appTitle = useMemo(() => (isKoreanLocale() ? '뉴핏' : '뉴핏'), []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [socialLoading, setSocialLoading] = useState<null | 'google' | 'kakao'>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const kakaoOAuthPendingRef = useRef(false);

  const authEmail = useMemo(() => {
    const u = username.trim();
    // Supabase Auth는 기본적으로 email/password 기반이므로, 아이디를 내부 이메일로 매핑합니다.
    return u ? `${u}@nutrimatch.local` : '';
  }, [username]);

  const canLogin = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && !loggingIn && !socialLoading;
  }, [loggingIn, password, socialLoading, username]);

  useEffect(() => {
    if (GOOGLE_WEB_CLIENT_ID) {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
      });
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const appStateSub = AppState.addEventListener('change', nextState => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      // 카카오 웹 로그인 중 브라우저에서 뒤로 나온 경우 콜백이 없으므로 로딩 상태를 복구합니다.
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active' && kakaoOAuthPendingRef.current) {
        kakaoOAuthPendingRef.current = false;
        setSocialLoading(current => (current === 'kakao' ? null : current));
      }
    });

    return () => {
      mounted = false;
      appStateSub.remove();
    };
  }, []);

  const handleGoogleNativeLogin = async () => {
    try {
      if (!isSupabaseConfigured || !supabase) {
        alert({
          title: '로그인 설정 필요',
          message: '현재 오류가 있어 로그인할 수 없습니다.',
        });
        return;
      }
      const client = supabase;

      if (!GOOGLE_WEB_CLIENT_ID) {
        alert({
          title: 'Google 로그인 설정 필요',
          message: '.env의 GOOGLE_WEB_CLIENT_ID를 확인하고 앱을 다시 빌드해주세요.',
        });
        return;
      }

      setSocialLoading('google');

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result: any = await GoogleSignin.signIn();
      const idToken = result?.idToken || result?.data?.idToken;
      if (!idToken) {
        throw new Error('Google ID 토큰을 가져오지 못했습니다.');
      }

      const { error } = await client.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      } as any);
      if (error) throw error;
    } catch (e: any) {
      const code = String(e?.code || '');
      if (code === statusCodes.SIGN_IN_CANCELLED || code === '12501') {
        alert({ title: 'Google 로그인 취소', message: '로그인이 취소되었습니다.' });
      } else if (code === statusCodes.IN_PROGRESS) {
        alert({ title: 'Google 로그인 진행 중', message: '로그인이 이미 진행 중입니다. 잠시만 기다려주세요.' });
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        alert({ title: 'Google Play 서비스 오류', message: 'Google Play 서비스를 업데이트한 뒤 다시 시도해주세요.' });
      } else {
        const raw = String(e?.message ?? e ?? '');
        const isDeveloperError = code === '10' || /developer_error|12500/i.test(raw);

        if (isDeveloperError) {
          alert({
            title: 'Google 로그인 설정 오류',
            message:
              'Google Cloud Console에서 Android OAuth 클라이언트(package: com.front, SHA-1)와 Web Client ID를 다시 확인해주세요.\n\n또한 .env의 GOOGLE_WEB_CLIENT_ID가 Web Client ID와 정확히 일치해야 합니다.',
          });
        } else {
          alert({
            title: 'Google 로그인 실패',
            message: getOAuthErrorMessage(e),
          });
        }
      }
    } finally {
      setSocialLoading(current => (current === 'google' ? null : current));
    }
  };

  const handleKakaoLogin = async () => {
    if (!isSupabaseConfigured || !supabase) {
      alert({
        title: '로그인 설정 필요',
        message: '현재 오류가 있어 로그인할 수 없습니다.',
      });
      return;
    }

    const client = supabase;

    // 네이티브 앱 키가 비어있으면 로그인 자체를 막고 설정 안내를 보여줍니다.
    if (!KAKAO_NATIVE_APP_KEY) {
      alert({
        title: '카카오 로그인 설정 필요',
        message: '.env의 KAKAO_NATIVE_APP_KEY를 설정하고 앱을 다시 빌드해주세요.',
      });
      return;
    }

    try {
      setSocialLoading('kakao');

      // 1) Native Kakao app/web SDK login (앱 우선)
      const nativeToken = await kakaoNativeLogin();
      const accessToken = String((nativeToken as any)?.accessToken || '').trim();
      if (!accessToken) throw new Error('카카오 액세스 토큰을 가져오지 못했습니다.');

      // 2) Exchange via edge function -> deterministic Supabase credentials
      const { data: bridgeData, error: bridgeErr } = await client.functions.invoke('kakao-native-login', {
        method: 'POST',
        body: { accessToken },
      });
      if (bridgeErr) throw bridgeErr;

      const email = String((bridgeData as any)?.data?.email || '').trim();
      const bridgePassword = String((bridgeData as any)?.data?.password || '').trim();
      if (!email || !bridgePassword) {
        throw new Error('카카오 로그인 브릿지 응답이 올바르지 않습니다.');
      }

      // 3) Sign in to Supabase using returned credentials
      const { error: signInErr } = await client.auth.signInWithPassword({
        email,
        password: bridgePassword,
      });
      if (signInErr) throw signInErr;
      kakaoOAuthPendingRef.current = false;
      return;
    } catch (nativeErr: any) {
      kakaoOAuthPendingRef.current = false;
      setSocialLoading(null);

      const nativeMsg = String(nativeErr?.message ?? nativeErr ?? '').toLowerCase();
      const isCancel = nativeMsg.includes('cancel') || nativeMsg.includes('취소');
      alert({
        title: isCancel ? '카카오 로그인 취소' : '카카오 로그인 실패',
        message: getKakaoErrorMessage(nativeErr),
      });
      return;
    }

  };

  const handleLogin = async () => {
    if (!canLogin) {
      alert({ title: '입력이 필요해요', message: '아이디와 비밀번호를 입력해주세요.' });
      return;
    }

    try {
      setLoggingIn(true);
      if (!isSupabaseConfigured || !supabase) {
        alert({
          title: '로그인 설정 필요',
          message: '현재 오류가 있어 로그인할 수 없습니다.',
        });
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });
      if (error) throw error;
      if (!data?.session) throw new Error('세션 생성에 실패했습니다.');

      // 서버 프로필(app_users) 로드 → UI에서 username/nickname 기반으로 표시
      try {
        const remoteProfile = await retryAsync(() => fetchMyAppUser(), { retries: 1, delayMs: 700 });
        await setProfile({
          ...remoteProfile,
          // 앱 내부 표시용 필드는 유지(서버 스키마에는 없음)
          plan_id: (profile as any)?.plan_id,
          premium_quota_remaining: (profile as any)?.premium_quota_remaining,
          free_image_quota_remaining: (profile as any)?.free_image_quota_remaining,
        } as any);
      } catch {
        // profile fetch 실패해도 로그인 자체는 유지
      }
      // 라우팅은 RootNavigator의 auth listener가 처리합니다.
    } catch (e: any) {
      let message = getLoginErrorMessage(e);

      // 아이디/비밀번호 로그인 실패 시, 소셜 가입 계정인지 힌트를 제공합니다.
      if (isInvalidCredentialError(e) && isSupabaseConfigured && supabase) {
        try {
          const u = username.trim();
          if (u) {
            const { data, error } = await supabase.functions.invoke('auth-provider-hint', {
              method: 'POST',
              body: { username: u },
            });

            if (!error) {
              const providerHint = (data as any)?.data?.providerHint;
              const providerMessage = getProviderHintMessage(providerHint);
              if (providerMessage) message = providerMessage;
            }
          }
        } catch {
          // ignore hint lookup failures
        }
      }

      alert({
        title: '로그인 실패',
        message,
      });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleFindEmail = () => {
    alert({
      title: '아이디 찾기',
      message: '고객센터(psunghyi@gmail.com)로 문의해주세요.',
    });
  };

  const handleFindPassword = () => {
    alert({
      title: '비밀번호 찾기',
      message: '고객센터(psunghyi@gmail.com)로 문의해주세요.',
    });
  };

  return (  
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar
        hidden={false}
        barStyle="dark-content"
        backgroundColor={COLORS.background}
        translucent={false}
      />
      <View style={styles.content}>
        <View style={styles.header}> 
          <Text style={styles.title}>{appTitle}</Text>
          <Text style={styles.subtitle}>나만의 AI 영양 관리 파트너</Text>
        </View> 
  
          <View style={styles.inputStack}> 
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>아이디</Text>
              <TextInput  
                value={username}
                onChangeText={setUsername}
                placeholder="아이디"  
                placeholderTextColor={COLORS.textGray}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>비밀번호</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="비밀번호"
                  placeholderTextColor={COLORS.textGray}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.passwordInput]}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(v => !v)}
                  style={styles.eyeButton}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                >
                  <AppIcon
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={22}
                    color={COLORS.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <Button
            title="로그인"
            onPress={handleLogin}
            disabled={!canLogin}
            loading={loggingIn}
            style={styles.loginButton}
          />

          <View style={styles.linkRow}>
            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.signupLinkText}>회원가입</Text>
            </TouchableOpacity>
            <Text style={styles.findDivider}>|</Text>
            <TouchableOpacity onPress={handleFindEmail}>
              <Text style={styles.signupLinkText}>아이디 찾기</Text>
            </TouchableOpacity>
            <Text style={styles.findDivider}>|</Text>
            <TouchableOpacity onPress={handleFindPassword}>
              <Text style={styles.signupLinkText}>비밀번호 찾기</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.googleButton}
            onPress={handleGoogleNativeLogin}
            disabled={socialLoading !== null || loggingIn}
          >
            <View style={styles.googleIcon}>
              <GoogleMark />
            </View>
            <Text style={styles.googleText}>
              {socialLoading === 'google' ? 'Google 로그인 중...' : 'Google로 로그인'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.kakaoButton}
            onPress={handleKakaoLogin}
            disabled={socialLoading !== null || loggingIn}
          >
            <View style={styles.kakaoIcon}>
              <KakaoMark />
            </View>
            <Text style={styles.kakaoText}>
              {socialLoading === 'kakao' ? '카카오 로그인 중...' : '카카오로 로그인'}
            </Text>
          </TouchableOpacity>
        </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textGray,
  },
  form: {
    gap: 16,
  },
  inputStack: {
    gap: 10,
  },
  loginButton: {
    width: '100%',
    marginTop: 14,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 46,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    width: '100%',
    alignSelf: 'stretch',
  },
  signupLink: {
    alignItems: 'flex-start',
  },
  accountFindLink: {
    alignItems: 'flex-end',
  },
  findRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  findDivider: {
    marginHorizontal: 8,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  signupLinkText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textDecorationLine: 'underline',
    textDecorationColor: COLORS.border,
  },
  googleButton: {
    width: '100%',
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    position: 'absolute',
    left: 14,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3C4043',
  },
  kakaoButton: {
    width: '100%',
    height: 48,
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9D300',
    backgroundColor: '#FEE500',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoIcon: {
    position: 'absolute',
    left: 14,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3A1D1D',
  },
  divider: {
    height: 1,
    width: '100%',
    backgroundColor: COLORS.text,
    marginVertical: 12,
  },
});
