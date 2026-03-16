import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  StatusBar,
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  useWindowDimensions,
  Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { COLORS, RADIUS } from '../../constants/colors';
import { AppIcon } from '../../components/ui/AppIcon';
import { analyzeFoodImage } from '../../services/api';
import { FoodAnalysis } from '../../types/user';
import { useUserStore } from '../../store/userStore';
import { ensureUserAnalysis } from '../../services/userAnalysis';
import { useAppAlert } from '../../components/ui/AppAlert';
import { Card } from '../../components/ui/Card';
import { consumeMonthlyScanRemote, getSessionUserId, insertFoodLogRemote, listFoodLogsRemote, refundLastScanRemote } from '../../services/userData';
import { getPlanLimits } from '../../services/plans';
import { useTheme } from '../../theme/ThemeProvider';
import { completeScanTutorial, getScanTutorialState } from '../../services/scanTutorialState';

function tryGetImageResizer(): any | null {
  try {
    return require('react-native-image-resizer')?.default ?? require('react-native-image-resizer');
  } catch {
    return null;
  }
}

function toFileUri(uriOrPath: string) {
  if (!uriOrPath) return '';
  if (uriOrPath.startsWith('file://')) return uriOrPath;
  if (uriOrPath.startsWith('content://')) return uriOrPath;
  return `file://${uriOrPath}`;
}

function isLocalDeviceUri(value: unknown): value is string {
  return typeof value === 'string' && /^(file|content):\/\//i.test(value);
}

async function getImageSizeSafe(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    try {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
}

async function fileUriToBase64(uri: string): Promise<string | null> {
  const normalized = toFileUri(uri);
  if (!normalized) return null;

  try {
    const response = await fetch(normalized);
    const blob = await response.blob();

    return await new Promise<string | null>((resolve) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const idx = result.indexOf('base64,');
          resolve(idx >= 0 ? result.slice(idx + 'base64,'.length) : (result || null));
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

function uuidv4(): string {
  try {
    const c = (globalThis as any)?.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }

  const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const b = hex.map(n => n.toString(16).padStart(2, '0')).join('');
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}

export default function VerifyScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { imageUri, autoAnalyze } = route.params as { imageUri: string; autoAnalyze?: boolean };
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzeInFlightRef = useRef(false);
  const profile = useUserStore(state => state.profile);
  const addFoodLog = useUserStore(state => state.addFoodLog);
  const setFoodLogs = useUserStore(state => state.setFoodLogs);
  const monthlyScanLimit = getPlanLimits(profile?.plan_id).monthlyScanLimit;
  const { alert } = useAppAlert();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const loadingChars = useMemo(() => ['분', '석', '중', '.', '.', '.'], []);
  const waveValuesRef = useRef(loadingChars.map(() => new Animated.Value(0)));
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const emojiFloat = useRef(new Animated.Value(0)).current;
  const waveLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const emojiLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const insets = useSafeAreaInsets();
  const tutorialTop = (insets.top || StatusBar.currentHeight || 0) + 8;
  const [showVerifyTutorial, setShowVerifyTutorial] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const consumeScanOrAlert = async () => {
    const userId = await getSessionUserId().catch(() => null);
    if (!userId) {
      alert({
        title: '로그인 필요',
        message: '스캔 분석은 서버 연결이 필요해요. 네트워크 연결을 확인한 뒤 로그인 후 다시 시도해주세요.',
      });
      return false;
    }

    try {
      await consumeMonthlyScanRemote(monthlyScanLimit);
      return true;
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/SCAN_LIMIT_REACHED/i.test(msg)) {
        alert({
          title: '스캔 기회 소진',
          message: `이번 달 스캔 기회를 모두 사용했어요. (${monthlyScanLimit}회/월)`,
        });
        return false;
      }
      // 네트워크/서버 오류: 보수적으로 막고 사용자에게 알림
      alert({
        title: '스캔 처리 실패',
        message: '스캔 횟수 처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
      });
      return false;
    }
  };

  const analyzeButtonAnchorRef = useRef<View | null>(null);
  const [analyzeButtonRect, setAnalyzeButtonRect] = useState<null | { x: number; y: number; width: number; height: number }>(null);

  const measureAnalyzeButton = () => {
    analyzeButtonAnchorRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setAnalyzeButtonRect(prev => {
          if (prev && prev.x === x && prev.y === y && prev.width === width && prev.height === height) return prev;
          return { x, y, width, height };
        });
      }
    });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const userId = await getSessionUserId().catch(() => null);
      if (!mounted) return;
      setSessionUserId(userId);
      const tutorialState = getScanTutorialState(userId);
      setShowVerifyTutorial(Boolean(!tutorialState.seen && tutorialState.phase === 'verify'));
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const finalizeTutorial = async () => {
    setShowVerifyTutorial(false);
    completeScanTutorial(sessionUserId);
  };

  const handleRetake = () => {
    navigation.goBack();
  };

  const handleAnalyze = async () => {
    if (analyzeInFlightRef.current) return;
    analyzeInFlightRef.current = true;

    const ok = await consumeScanOrAlert();
    if (!ok) {
      analyzeInFlightRef.current = false;
      return;
    }

    setIsAnalyzing(true);
    console.log('[VerifyScreen] 분석 시작');
    try {
      // Enforce max 1024 only at upload/analyze time.
      let uploadUri = imageUri;
      console.log('[VerifyScreen] 이미지 URI:', uploadUri);
      const size = await getImageSizeSafe(imageUri);
      if (size && (size.width > 1024 || size.height > 1024)) {
        const Resizer = tryGetImageResizer();
        if (Resizer?.createResizedImage) {
          const resized = await Resizer.createResizedImage(
            imageUri,
            1024,
            1024,
            'JPEG',
            85,
            0,
            undefined,
            false,
            {
              mode: 'contain',
              onlyScaleDown: true,
            } as any
          );
          const resizedUri = toFileUri((resized as any)?.uri || (resized as any)?.path);
          if (resizedUri) uploadUri = resizedUri;
        }
      }

      console.log('[VerifyScreen] analyzeFoodImage 호출 시작');
      const response = await analyzeFoodImage(
        uploadUri,
        profile
          ? {
              bodyGoal: profile.bodyGoal,
              healthDiet: profile.healthDiet,
              lifestyleDiet: profile.lifestyleDiet,
              allergens: profile.allergens,
              currentWeight: profile.currentWeight,
              targetWeight: profile.targetWeight,
              height: profile.height,
              age: profile.age,
              gender: profile.gender,
            }
          : null
      );
      
      if (!response.ok || !response.data) {
        throw new Error(response.message || '분석에 실패했습니다.');
      }

      const data = response.data;

      const resolveDishName = (d: any): string => {
        const dish = d?.dish;
        if (typeof dish === 'string' && dish.trim()) return dish.trim();
        if (dish && typeof dish === 'object') {
          const name = (dish as any)?.name;
          if (typeof name === 'string' && name.trim()) return name.trim();
        }
        const dishName = d?.dishName;
        if (typeof dishName === 'string' && dishName.trim()) return dishName.trim();

        const brand = d?.brand;
        const fallbackLabels = Array.isArray(d?.detections)
          ? d.detections
              .map((x: any) => (typeof x?.label === 'string' ? x.label.trim() : ''))
              .filter((x: string) => Boolean(x))
          : [];
        if (typeof brand === 'string' && brand.trim() && fallbackLabels.length > 0) {
          return `${brand.trim()} ${fallbackLabels[0]}`;
        }
        if (fallbackLabels.length > 0) return fallbackLabels[0];
        return '알 수 없는 음식';
      };
      
      const dishName = resolveDishName(data);
      const isUnknown = dishName === '알 수 없는 음식';

      // Map API response to FoodAnalysis type
      const analysis: FoodAnalysis = {
        dishName,
        description: data.notes || '분석된 정보가 없습니다.',
        categories: [], 
        confidence: data.confidence || 0,
        ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
        allergens: Array.isArray(data.allergens) ? data.allergens : [],
        detections: Array.isArray((data as any).detections) ? (data as any).detections : [],
        macros: {
          // Keep as many macro fields as backend provides.
          calories: isUnknown ? 0 : data.estimated_macros?.calories,
          carbs_g: isUnknown ? 0 : data.estimated_macros?.carbs_g,
          protein_g: isUnknown ? 0 : data.estimated_macros?.protein_g,
          fat_g: isUnknown ? 0 : data.estimated_macros?.fat_g,
          sugar_g: data.estimated_macros?.sugar_g,
          saturated_fat_g: data.estimated_macros?.saturated_fat_g,
          trans_fat_g: data.estimated_macros?.trans_fat_g,
          sodium_mg: data.estimated_macros?.sodium_mg,
          cholesterol_mg: data.estimated_macros?.cholesterol_mg,
          fiber_g: data.estimated_macros?.fiber_g,
        },
        userAnalysis: data.userAnalysis,
        source: data.source,
        referenceStandard: data.reference_standard,
        geminiUsed: data.geminiUsed || false,
      };

      // Always ensure detailed user-facing analysis text exists
      analysis.userAnalysis = ensureUserAnalysis(analysis, profile);

      const savedAt = new Date().toISOString();
      const sessionUserId = await getSessionUserId().catch(() => null);
      const imageBase64 = await fileUriToBase64(uploadUri);

      if (!sessionUserId) {
        throw new Error('로그인 상태에서만 분석 기록을 저장할 수 있어요. 다시 로그인 후 시도해주세요.');
      }

      const localId = uuidv4();
      const remoteLog = await insertFoodLogRemote({
        id: localId,
        userId: sessionUserId,
        imageUri: uploadUri,
        imageBase64,
        analysis,
        mealType: 'snack',
        timestamp: savedAt,
      } as any);

      const remoteLogs = await listFoodLogsRemote(100).catch(() => null);
      if (Array.isArray(remoteLogs)) {
        await setFoodLogs(remoteLogs);
      } else if (remoteLog) {
        await setFoodLogs([remoteLog as any]);
      }

      navigation.navigate('Result', {
        imageUri: uploadUri,
        analysis,
      });
    } catch (error: any) {
      console.error('[VerifyScreen] AI 분석 오류:', error);
      console.error('[VerifyScreen] 오류 상세:', JSON.stringify(error, null, 2));
      
      // AI 분석 실패 시 스캔 횟수 복구
      let refundSuccess = false;
      try {
        const result = await refundLastScanRemote();
        refundSuccess = Boolean(result);
        if (refundSuccess) {
          console.log('[VerifyScreen] 스캔 횟수 복구 완료');
        }
      } catch (refundError: any) {
        console.error('[VerifyScreen] 스캔 횟수 복구 실패:', refundError);
        // PGRST202 에러는 함수가 없는 경우 (마이그레이션 미적용)
        const isNotFoundError = refundError?.message?.includes('PGRST202') || 
                                refundError?.code === 'PGRST202';
        if (isNotFoundError) {
          console.warn('[VerifyScreen] refund_last_scan 함수가 데이터베이스에 없습니다. 마이그레이션을 적용해주세요.');
        }
      }
      
      // 더 자세한 에러 정보 표시
      const errorDetails = error?.response?.data || error?.data || {};
      const errorMsg = error.message || error?.toString() || '음식 분석 중 오류가 발생했습니다.';
      const fullMessage = refundSuccess 
        ? `${errorMsg}\n\n스캔 횟수는 복구되었어요.`
        : `${errorMsg}\n\n${JSON.stringify(errorDetails).substring(0, 200)}`;
      
      alert({
        title: 'AI 분석 중 오류',
        message: fullMessage,
      });
    } finally {
      setIsAnalyzing(false);
      analyzeInFlightRef.current = false;
    }
  };

  const autoAnalyzeTriggeredRef = useRef(false);
  useEffect(() => {
    if (!autoAnalyze) return;
    if (autoAnalyzeTriggeredRef.current) return;
    autoAnalyzeTriggeredRef.current = true;
    setShowVerifyTutorial(false);

    const t = setTimeout(() => {
      void handleAnalyze();
    }, 80);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyze]);

  useEffect(() => {
    if (isAnalyzing) {
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      const waveAnimations = waveValuesRef.current.map((value) =>
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 320,
            easing: Easing.in(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );

      waveLoopRef.current?.stop();
      waveLoopRef.current = Animated.loop(Animated.stagger(90, waveAnimations));
      waveLoopRef.current.start();

      emojiLoopRef.current?.stop();
      emojiLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(emojiFloat, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(emojiFloat, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      emojiLoopRef.current.start();
      return;
    }

    waveLoopRef.current?.stop();
    emojiLoopRef.current?.stop();
    Animated.timing(backdropOpacity, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    waveValuesRef.current.forEach((value) => value.setValue(0));
    emojiFloat.setValue(0);
  }, [backdropOpacity, emojiFloat, isAnalyzing, loadingChars]);

  const handleAnalyzeFromTutorial = async () => {
    if (showVerifyTutorial) {
      await finalizeTutorial();
    }
    await handleAnalyze();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.backgroundGray}
      />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
          <AppIcon name="close" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Card style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={[styles.heroIcon, { backgroundColor: colors.blue50 }]}>
              <AppIcon name="photo" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroText}>
              <Text style={[styles.title, { color: colors.text }]}>사진 확인</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>글자/음식이 선명하면 정확도가 올라가요</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.previewCard}>
          <View style={[styles.imageContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
          </View>
          <Text style={[styles.previewHint, { color: colors.textSecondary }]}>
            이 화면은 미리보기예요. 분석 결과는 사진 기반 추정입니다.
          </Text>
        </Card>

        <View style={styles.buttonGroup}>
          <View style={styles.buttonSlot}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleRetake}
              disabled={isAnalyzing}
              style={[
                styles.actionButton,
                styles.actionButtonOutline,
                {
                  borderColor: colors.primaryDark,
                  backgroundColor: isDark ? colors.blue50 : colors.blue50,
                },
                isAnalyzing && styles.actionButtonDisabled,
              ]}
            >
              <AppIcon name="refresh" size={18} color={colors.primaryDark} />
              <Text style={[styles.actionButtonText, { color: colors.primaryDark }]}>다시 찍기</Text>
            </TouchableOpacity>
          </View>
          <View ref={analyzeButtonAnchorRef} onLayout={measureAnalyzeButton} style={styles.buttonSlot}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleAnalyzeFromTutorial}
              disabled={isAnalyzing}
              style={[
                styles.actionButton,
                styles.actionButtonPrimary,
                { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
                isAnalyzing && styles.actionButtonDisabled,
              ]}
            >
              {isAnalyzing ? <ActivityIndicator color="#FFFFFF" /> : <AppIcon name="check" size={18} color="#FFFFFF" />}
              <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>
                {isAnalyzing ? '분석 중...' : '분석 시작'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Animated.View
        pointerEvents={isAnalyzing ? 'auto' : 'none'}
        style={[
          styles.analyzingOverlay,
          {
            opacity: backdropOpacity,
            backgroundColor: isDark ? 'rgba(6,10,18,0.58)' : 'rgba(255,255,255,0.62)',
          },
        ]}
      >
        <View style={[styles.analyzingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Animated.Text
            style={[
              styles.analyzingEmoji,
              {
                transform: [
                  {
                    translateY: emojiFloat.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -8],
                    }),
                  },
                  {
                    scale: emojiFloat.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.05],
                    }),
                  },
                ],
              },
            ]}
          >
            🤖
          </Animated.Text>
          <Text style={[styles.analyzingTitle, { color: colors.text }]}>AI가 열심히 보고 있어요</Text>
          <View style={styles.waveRow}>
            {loadingChars.map((char, idx) => {
              const animatedValue = waveValuesRef.current[idx];
              return (
                <Animated.Text
                  key={`${char}-${idx}`}
                  style={[
                    styles.waveChar,
                    {
                      color: colors.primaryDark,
                      transform: [
                        {
                          translateY: animatedValue.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, -7],
                          }),
                        },
                      ],
                      opacity: animatedValue.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.72, 1],
                      }),
                    },
                  ]}
                >
                  {char}
                </Animated.Text>
              );
            })}
          </View>
        </View>
      </Animated.View>

      <Modal transparent visible={showVerifyTutorial} animationType="fade">
        <View style={styles.tutorialModalRoot} onLayout={measureAnalyzeButton}>
          <View style={[styles.tutorialTopRow, { paddingTop: tutorialTop }]}>
            <Text style={styles.tutorialTopLabel} accessibilityRole="text">
              사용 가이드
            </Text>
            <TouchableOpacity onPress={finalizeTutorial} accessibilityRole="button" style={styles.tutorialSkip}>
              <Text style={styles.tutorialSkipText}>건너뛰기</Text>
            </TouchableOpacity>
          </View>

          {!!analyzeButtonRect && (
            <>
              {(() => {
                const highlightPadding = 6;
                const holeX = analyzeButtonRect.x - highlightPadding;
                const holeY = analyzeButtonRect.y - highlightPadding;
                const holeW = analyzeButtonRect.width + highlightPadding * 2;
                const holeH = analyzeButtonRect.height + highlightPadding * 2;
                const holeR = RADIUS.sm + highlightPadding;

                return (
                  <>
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => {}}
                      style={styles.tutorialTouchAbsorber}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />

                    <Svg
                      pointerEvents="none"
                      width={screenWidth}
                      height={screenHeight}
                      style={styles.tutorialDimSvg}
                    >
                      <Defs>
                        <Mask id="verifyCutoutMask">
                          <Rect width="100%" height="100%" fill="white" />
                          <Rect x={holeX} y={holeY} width={holeW} height={holeH} rx={holeR} ry={holeR} fill="black" />
                        </Mask>
                      </Defs>
                      <Rect
                        width="100%"
                        height="100%"
                        fill="rgba(0,0,0,0.35)"
                        mask="url(#verifyCutoutMask)"
                      />
                    </Svg>

                    <View
                      pointerEvents="none"
                      style={[
                        styles.tutorialHighlight,
                        {
                          left: holeX,
                          top: holeY,
                          width: holeW,
                          height: holeH,
                          borderRadius: holeR,
                        },
                      ]}
                    />

                    <View
                      pointerEvents="none"
                      style={[
                        styles.tutorialHint,
                        {
                          left: Math.max(16, analyzeButtonRect.x + analyzeButtonRect.width / 2 - 130),
                          top: Math.max(tutorialTop + 10, analyzeButtonRect.y - 78),
                        },
                      ]}
                    >
                      <Text style={styles.tutorialHintText}>분석 시작을 눌러 결과를 확인해요</Text>
                      <Text style={styles.tutorialArrow}>↓</Text>
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={handleAnalyzeFromTutorial}
                      style={[
                        styles.tutorialCtaHitbox,
                        {
                          left: analyzeButtonRect.x - 10,
                          top: analyzeButtonRect.y - 10,
                          width: analyzeButtonRect.width + 20,
                          height: analyzeButtonRect.height + 20,
                        },
                      ]}
                    />
                  </>
                );
              })()}
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundGray,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    gap: 14,
  },
  heroCard: {
    padding: 16,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  previewCard: {
    padding: 14,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  previewHint: {
    marginTop: 10,
    fontSize: 12,
  },
  buttonGroup: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  buttonSlot: {
    flex: 1,
  },
  actionButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: RADIUS.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  actionButtonOutline: {
    backgroundColor: COLORS.background,
  },
  actionButtonPrimary: {
    borderColor: 'transparent',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  actionButtonTextPrimary: {
    color: '#FFFFFF',
  },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    paddingHorizontal: 28,
  },
  analyzingCard: {
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  analyzingEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  analyzingTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  waveChar: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  tutorialModalRoot: {
    flex: 1,
  },
  tutorialTouchAbsorber: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  tutorialDimSvg: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  tutorialTopRow: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 30,
  },
  tutorialTopLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    opacity: 0.9,
  },
  tutorialSkip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tutorialSkipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  tutorialHighlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: RADIUS.sm,
    zIndex: 15,
  },
  tutorialHint: {
    position: 'absolute',
    width: 260,
    alignItems: 'center',
    zIndex: 20,
  },
  tutorialHintText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  tutorialArrow: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
  },
  tutorialCtaHitbox: {
    position: 'absolute',
    backgroundColor: 'transparent',
    zIndex: 25,
  },
});
