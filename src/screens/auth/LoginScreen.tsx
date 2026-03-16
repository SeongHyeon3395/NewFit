import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
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

  const authEmail = useMemo(() => {
    const u = username.trim();
    // Supabase Auth는 기본적으로 email/password 기반이므로, 아이디를 내부 이메일로 매핑합니다.
    return u ? `${u}@nutrimatch.local` : '';
  }, [username]);

  const canLogin = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && !loggingIn;
  }, [loggingIn, password, username]);

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
      alert({
        title: '로그인 실패',
        message: getLoginErrorMessage(e),
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
    <SafeAreaView style={styles.container}>
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

          <Button title="로그인" onPress={handleLogin} disabled={!canLogin} loading={loggingIn} style={{ width: '100%' }} />

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
            onPress={() => alert({ title: 'Google 로그인', message: '출시 버전에서 연동 예정입니다.' })}
          >
            <View style={styles.googleIcon}>
              <GoogleMark />
            </View>
            <Text style={styles.googleText}>Google로 로그인</Text>
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
  divider: {
    height: 1,
    width: '100%',
    backgroundColor: COLORS.text,
  },
});
