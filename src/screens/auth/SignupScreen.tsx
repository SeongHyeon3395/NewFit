import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { COLORS } from '../../constants/colors';
import { Button } from '../../components/ui/Button';
import { AppIcon } from '../../components/ui/AppIcon';
import { useAppAlert } from '../../components/ui/AppAlert';
import { RootStackParamList } from '../../navigation/types';
import { checkUsername, signupDevice } from '../../services/api';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Signup'>;

function passwordChecks(value: string) {
  const v = value;
  const hasMinLength = v.length >= 8;
  const hasSpecialChar = /[^A-Za-z0-9]/.test(v);
  return { hasMinLength, hasSpecialChar, ok: hasMinLength && hasSpecialChar };
}

export default function SignupScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { alert } = useAppAlert();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [nickname, setNickname] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [agreeRequired, setAgreeRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [usernameCheckStatus, setUsernameCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>(
    'idle'
  );
  const [usernameCheckMessage, setUsernameCheckMessage] = useState<string>('');

  const usernameValid = useMemo(() => username.trim().length > 0, [username]);
  const usernameAvailable = useMemo(() => usernameCheckStatus === 'available', [usernameCheckStatus]);
  const pw = useMemo(() => passwordChecks(password), [password]);
  const pwMatch = useMemo(() => password.length > 0 && password === passwordConfirm, [password, passwordConfirm]);
  const nicknameValid = useMemo(() => nickname.trim().length > 0, [nickname]);

  const canSubmit = useMemo(() => {
    return (
      !submitting &&
      usernameValid &&
      usernameAvailable &&
      pw.ok &&
      pwMatch &&
      nicknameValid &&
      agreeRequired
    );
  }, [agreeRequired, nicknameValid, pw.ok, pwMatch, submitting, usernameAvailable, usernameValid]);

  useEffect(() => {
    // 아이디 변경 시 중복확인 결과 초기화
    setUsernameCheckStatus('idle');
    setUsernameCheckMessage('');
  }, [username]);

  const handleCheckUsername = async () => {
    const v = username.trim();
    if (!v) {
      setUsernameCheckStatus('error');
      setUsernameCheckMessage('아이디를 입력해주세요.');
      return;
    }

    try {
      setUsernameCheckStatus('checking');
      setUsernameCheckMessage('');
      const res = await checkUsername(v);

      if (res?.data?.available) {
        setUsernameCheckStatus('available');
        setUsernameCheckMessage('사용 가능한 아이디예요.');
      } else {
        setUsernameCheckStatus('taken');
        setUsernameCheckMessage('중복되는 아이디예요.');
      }
    } catch (e: any) {
      setUsernameCheckStatus('error');
      setUsernameCheckMessage(e?.message || '중복확인에 실패했어요.');
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!usernameValid) {
      alert({ title: '아이디 입력', message: '아이디를 입력해주세요.' });
      return;
    }
    if (!usernameAvailable) {
      alert({ title: '아이디 중복확인', message: '아이디 중복확인을 진행해주세요.' });
      return;
    }
    if (!pw.ok) {
      alert({
        title: '비밀번호 확인',
        message: '비밀번호는 8자 이상, 특수문자를 포함해야 합니다.',
      });
      return;
    }
    if (!pwMatch) {
      alert({ title: '비밀번호 확인', message: '비밀번호가 일치하지 않습니다.' });
      return;
    }
    if (!nicknameValid) {
      alert({ title: '닉네임 입력', message: '앱에서 사용할 닉네임을 입력해주세요.' });
      return;
    }
    if (!agreeRequired) {
      alert({
        title: '약관 동의 필요',
        message: '서비스 이용약관 및 개인정보 처리방침에 동의해주세요.',
      });
      return;
    }

    try {
      setSubmitting(true);
      await signupDevice({
        username: username.trim(),
        nickname: nickname.trim(),
        password,
      });

      alert({
        title: '회원가입 완료',
        message: '회원가입이 완료되었습니다.\n로그인 화면으로 이동합니다.',
        actions: [
          {
            text: '확인',
            onPress: () => navigation.goBack(),
          },
        ],
      });
    } catch (e: any) {
      alert({
        title: '회원가입 실패',
        message: e?.message || String(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} translucent={false} hidden={false} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <AppIcon name="chevron-left" size={28} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>회원가입</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>아이디</Text>
            <View style={styles.usernameRow}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="아이디"
                placeholderTextColor={COLORS.textGray}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.usernameInput]}
                returnKeyType="next"
              />
              <Button
                title="중복확인"
                onPress={handleCheckUsername}
                size="sm"
                variant="outline"
                loading={usernameCheckStatus === 'checking'}
                disabled={!usernameValid || usernameCheckStatus === 'checking'}
                style={styles.usernameCheckButton}
              />
            </View>

            {usernameCheckMessage ? (
              <Text
                style={[
                  styles.helperText,
                  usernameCheckStatus === 'available'
                    ? styles.okText
                    : usernameCheckStatus === 'taken' || usernameCheckStatus === 'error'
                      ? styles.errText
                      : null,
                ]}
              >
                {usernameCheckMessage}
              </Text>
            ) : null}
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
                returnKeyType="next"
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

            <View style={styles.checkList}>
              <View style={styles.checkRow}>
                <AppIcon
                  name={pw.hasMinLength ? 'check-circle' : 'cancel'}
                  size={18}
                  color={pw.hasMinLength ? COLORS.success : COLORS.textSecondary}
                />
                <Text style={styles.checkText}>8자 이상</Text>
              </View>
              <View style={styles.checkRow}>
                <AppIcon
                  name={pw.hasSpecialChar ? 'check-circle' : 'cancel'}
                  size={18}
                  color={pw.hasSpecialChar ? COLORS.success : COLORS.textSecondary}
                />
                <Text style={styles.checkText}>특수문자 포함(예: !@#$)</Text>
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>비밀번호 확인</Text>
            <View style={styles.passwordRow}>
              <TextInput
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
                placeholder="비밀번호 확인"
                placeholderTextColor={COLORS.textGray}
                secureTextEntry={!showPasswordConfirm}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.passwordInput]}
                returnKeyType="next"
              />
              <TouchableOpacity
                onPress={() => setShowPasswordConfirm(v => !v)}
                style={styles.eyeButton}
                accessibilityRole="button"
                accessibilityLabel={showPasswordConfirm ? '비밀번호 확인 숨기기' : '비밀번호 확인 보기'}
              >
                <AppIcon
                  name={showPasswordConfirm ? 'visibility-off' : 'visibility'}
                  size={22}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {passwordConfirm.length > 0 && (
              <Text style={[styles.helperText, pwMatch ? styles.okText : styles.errText]}>
                {pwMatch ? '비밀번호가 일치해요.' : '비밀번호가 일치하지 않아요.'}
              </Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>닉네임</Text>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="예) 홍길동"
              placeholderTextColor={COLORS.textGray}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              returnKeyType="done"
            />
          </View>

          <View style={styles.termsBox}>
            <TouchableOpacity
              onPress={() => setAgreeRequired(v => !v)}
              style={styles.termsRow}
              activeOpacity={0.9}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreeRequired }}
            >
              <View style={[styles.checkbox, agreeRequired && styles.checkboxChecked]}>
                {agreeRequired && <AppIcon name="check" size={16} color="white" />}
              </View>

              <Text style={styles.termsText}>
                <Text style={styles.termsRequired}>(필수)</Text>
                <Text> </Text>
                <Text
                  style={styles.termsLink}
                  onPress={() => navigation.navigate('Terms')}
                  suppressHighlighting
                >
                  서비스 이용약관
                </Text>
                <Text> 및 </Text>
                <Text
                  style={styles.termsLink}
                  onPress={() => navigation.navigate('PrivacyPolicy')}
                  suppressHighlighting
                >
                  개인정보 처리방침
                </Text>
                <Text>에 동의합니다.</Text>
              </Text>
            </TouchableOpacity>
          </View>

          <Button
            title="가입하기"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
            style={{ width: '100%' }}
          />
        </View>
      </ScrollView>

      {submitting ? (
        <View style={styles.loadingOverlay} pointerEvents="auto">
          <View style={styles.loadingBackdrop} />
          <View style={styles.loadingContent}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.loadingText}>회원가입 처리 중…</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: COLORS.background,
      opacity: 0.85,
    },
    loadingContent: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: COLORS.background,
      alignItems: 'center',
      gap: 10,
    },
    loadingText: {
      color: COLORS.text,
      fontSize: 14,
      fontWeight: '600',
    },
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
    padding: 24,
  },
  form: {
    gap: 16,
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
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  usernameInput: {
    flex: 1,
  },
  usernameCheckButton: {
    height: 44,
    paddingHorizontal: 12,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  okText: {
    color: COLORS.success,
  },
  errText: {
    color: COLORS.danger,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 10,
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 2,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  termsBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.background,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: COLORS.background,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  termsRequired: {
    color: COLORS.danger,
    fontWeight: '700',
  },
  termsLink: {
    textDecorationLine: 'underline',
    textDecorationColor: COLORS.border,
    color: COLORS.text,
    fontWeight: '600',
  },
});
