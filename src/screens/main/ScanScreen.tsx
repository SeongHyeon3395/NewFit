import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StatusBar, View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Image, ScrollView, LayoutChangeEvent, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { useNetInfo } from '@react-native-community/netinfo';
import { COLORS, SPACING, RADIUS } from '../../constants/colors';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { useAppAlert } from '../../components/ui/AppAlert';
import { getMonthlyScanCountRemote, getSessionUserId, listFoodLogsRemote } from '../../services/userData';
import { pickPhotoFromLibrary } from '../../services/imagePicker';
import { ensureCameraPermissionWithPrompt, ensurePhotoLibraryPermissionWithPrompt } from '../../services/permissions';
import { useUserStore } from '../../store/userStore';
import { getPlanLimits } from '../../services/plans';
import { useTheme } from '../../theme/ThemeProvider';
import { completeScanTutorial, getScanTutorialState, markScanTutorialVerifyPhase } from '../../services/scanTutorialState';

export default function ScanScreen() {
  const navigation = useNavigation();
  const { alert } = useAppAlert();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const net = useNetInfo();
  const isOffline = net.isConnected === false || net.isInternetReachable === false;
  const isOnline = !isOffline;

  const [didScroll, setDidScroll] = useState(false);
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);

  const foodLogs = useUserStore(state => state.foodLogs);
  const profile = useUserStore(state => state.profile);
  const loadFoodLogs = useUserStore(state => state.loadFoodLogs);
  const setFoodLogs = useUserStore(state => state.setFoodLogs);
  const planLimits = getPlanLimits(profile?.plan_id);
  const monthlyScanLimit = planLimits.monthlyScanLimit;
  const recentLogs = useMemo(() => {
    const arr = Array.isArray(foodLogs) ? foodLogs : [];

    const safeTime = (value: unknown) => {
      const iso = typeof value === 'string' ? value : '';
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : 0;
    };

    return [...arr]
      .sort((a, b) => safeTime(b?.timestamp) - safeTime(a?.timestamp))
      .slice(0, 2);
  }, [foodLogs]);

  const [monthlyUsed, setMonthlyUsed] = useState<number | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);

  const scanButtonFixedRef = useRef<View | null>(null);
  const [scanButtonRect, setScanButtonRect] = useState<null | { x: number; y: number; width: number; height: number }>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const requestCameraPermissionWithAppAlert = useCallback(async () => {
    return ensureCameraPermissionWithPrompt({
      confirmRequest: () =>
        new Promise<boolean>((resolve) => {
          alert({
            title: '카메라 권한 필요',
            message: '사진을 찍으려면 카메라 권한 허용이 필요해요. 지금 허용할까요?',
            actions: [
              { text: '나중에', variant: 'outline', onPress: () => resolve(false) },
              { text: '권한 허용', variant: 'primary', onPress: () => resolve(true) },
            ],
          });
        }),
      onNeverAskAgain: ({ title, message, openSettings }) => {
        alert({
          title,
          message,
          actions: [
            { text: '닫기', variant: 'outline' },
            {
              text: '설정 열기',
              variant: 'primary',
              onPress: () => {
                void openSettings();
              },
            },
          ],
        });
      },
    });
  }, [alert]);

  const requestPhotoPermissionWithAppAlert = useCallback(async () => {
    return ensurePhotoLibraryPermissionWithPrompt({
      confirmRequest: () =>
        new Promise<boolean>((resolve) => {
          alert({
            title: '사진 접근 권한 필요',
            message: '라이브러리에서 사진을 선택하려면 사진 접근 권한 허용이 필요해요. 지금 허용할까요?',
            actions: [
              { text: '나중에', variant: 'outline', onPress: () => resolve(false) },
              { text: '권한 허용', variant: 'primary', onPress: () => resolve(true) },
            ],
          });
        }),
      onNeverAskAgain: ({ title, message, openSettings }) => {
        alert({
          title,
          message,
          actions: [
            { text: '닫기', variant: 'outline' },
            {
              text: '설정 열기',
              variant: 'primary',
              onPress: () => {
                void openSettings();
              },
            },
          ],
        });
      },
    });
  }, [alert]);

  const ensureScanQuotaOrAlert = async () => {
    const userId = await getSessionUserId().catch(() => null);
    if (!userId) {
      alert({
        title: '로그인 필요',
        message: '스캔 기록은 서버에만 저장돼요. 네트워크 연결을 확인한 뒤 로그인 후 다시 시도해주세요.',
      });
      return false;
    }

    try {
      const used = await getMonthlyScanCountRemote();
      if (typeof used === 'number' && used >= monthlyScanLimit) {
        alert({
          title: '스캔 기회 소진',
          message: `이번 달 스캔 기회를 모두 사용했어요. (${monthlyScanLimit}회/월)`,
        });
        return false;
      }
    } catch {
      // 카운트 조회 실패 시에는 보수적으로 막지 않음
    }
    return true;
  };

  const refreshMonthlyCount = useCallback(async () => {
    const userId = await getSessionUserId().catch(() => null);
    setIsLoggedIn(Boolean(userId));
    if (!userId) {
      setMonthlyUsed(null);
      return;
    }
    try {
      const used = await getMonthlyScanCountRemote();
      if (typeof used === 'number') setMonthlyUsed(used);
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      void (async () => {
        const userId = await getSessionUserId().catch(() => null);
        if (!alive) return;
        setSessionUserId(userId);
        const tutorialState = getScanTutorialState(userId);
        setShowTutorial(Boolean(tutorialState.pending && !tutorialState.seen && tutorialState.phase !== 'verify'));

        await refreshMonthlyCount();
        await loadFoodLogs();

        if (!userId) return;

        const remote = await listFoodLogsRemote(50).catch(() => null);
        if (!alive) return;

        if (Array.isArray(remote)) {
          await setFoodLogs(remote);
          return;
        }

        retryTimer = setTimeout(() => {
          if (!alive) return;
          void (async () => {
            const retried = await listFoodLogsRemote(50).catch(() => null);
            if (alive && Array.isArray(retried)) {
              await setFoodLogs(retried);
            }
          })();
        }, 900);
      })();

      return () => {
        alive = false;
        if (retryTimer) clearTimeout(retryTimer);
      };
    }, [refreshMonthlyCount, loadFoodLogs, setFoodLogs])
  );

  const measureScanButton = () => {
    // measureInWindow gives absolute coordinates for overlay alignment
    scanButtonFixedRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        setScanButtonRect(prev => {
          if (prev && prev.x === x && prev.y === y && prev.width === width && prev.height === height) return prev;
          return { x, y, width, height };
        });
      }
    });
  };

  useEffect(() => {
    if (!showTutorial) return;
    setTimeout(measureScanButton, 0);
  }, [showTutorial]);

  const finalizeTutorial = async () => {
    setShowTutorial(false);
    completeScanTutorial(sessionUserId);
  };

  const navigateToCamera = useCallback(() => {
    try {
      const nav: any = navigation as any;
      const rootNav = nav?.getParent?.() ?? nav;
      rootNav.navigate('Camera');
      return true;
    } catch (error: any) {
      console.error('Camera Error:', error);
      alert({ title: '오류', message: error?.message || '카메라를 실행하는 중 문제가 발생했습니다.' });
      return false;
    }
  }, [alert, navigation]);

  const ensureCameraLaunchReady = useCallback(async () => {
    if (!isOnline) {
      alert({
        title: '인터넷 연결 필요',
        message: '현재 오프라인 상태라 음식 분석을 할 수 없어요.\n인터넷 연결 후 다시 시도해주세요.',
      });
      return false;
    }

    const ok = await ensureScanQuotaOrAlert();
    if (!ok) return false;

    return requestCameraPermissionWithAppAlert();
  }, [isOnline, requestCameraPermissionWithAppAlert]);

  const goToVerifyTutorialPhase = async () => {
    // Hide scan overlay but continue tutorial on Verify screen.
    setShowTutorial(false);
    markScanTutorialVerifyPhase(sessionUserId);
  };

  const tutorialTop = (insets.top || StatusBar.currentHeight || 0) + 8;

  const handleTips = () => {
    alert({
      title: '촬영 팁',
      message: [
        '• 밝은 조명에서 촬영하세요',
        '• 음식은 접시 전체가 나오게 촬영하세요',
        '• 성분표/원재료명은 글자가 선명하게 나오게 가까이 촬영하세요',
        '• 흔들림 없이 선명하게 촬영하세요',
      ].join('\n'),
      actions: [{ text: '확인', variant: 'primary' }],
    });
  };

  const formatTime = (iso: string) => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const showScrollHint = !didScroll && scrollContentHeight > scrollViewportHeight + 24;

  const handleScan = useCallback(async () => {
    const ready = await ensureCameraLaunchReady();
    if (!ready) return;

    navigateToCamera();
  }, [ensureCameraLaunchReady, navigateToCamera]);

  const handleScanFromTutorial = useCallback(async () => {
    const ready = await ensureCameraLaunchReady();
    if (!ready) return;

    if (showTutorial) {
      await goToVerifyTutorialPhase();
    }

    navigateToCamera();
  }, [ensureCameraLaunchReady, goToVerifyTutorialPhase, navigateToCamera, showTutorial]);

  const handleGallery = useCallback(async () => {
    if (!isOnline) {
      alert({
        title: '인터넷 연결 필요',
        message: '현재 오프라인 상태라 음식 분석을 할 수 없어요.\n인터넷 연결 후 다시 시도해주세요.',
      });
      return;
    }

    const ok = await ensureScanQuotaOrAlert();
    if (!ok) return;

    const hasPhotoPermission = await requestPhotoPermissionWithAppAlert();
    if (!hasPhotoPermission) return;

    try {
      const picked = await pickPhotoFromLibrary({ quality: 0.84 });
      if (picked?.uri) {
        const nav: any = navigation as any;
        const rootNav = nav?.getParent?.() ?? nav;
        rootNav.navigate('Edit', { imageUri: picked.uri });
      }
    } catch (error: any) {
      console.error('Gallery Error:', error);
      alert({ title: '오류', message: error?.message || '갤러리를 여는 중 문제가 발생했습니다.' });
    }
  }, [alert, navigation, requestPhotoPermissionWithAppAlert]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>음식 분석</Text>
      </View>

      {!isOnline ? (
        <View style={[styles.offlineBanner, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <Text style={[styles.offlineBannerText, { color: colors.textSecondary }]}>
            오프라인 상태예요. 음식 분석은 인터넷 연결 후 사용 가능합니다.
          </Text>
        </View>
      ) : null}

      <View style={styles.content}>
        <ScrollView
          contentContainerStyle={styles.scrollInner}
          style={{ flex: 1 }}
          onLayout={(e: LayoutChangeEvent) => setScrollViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_, h) => setScrollContentHeight(h)}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (e.nativeEvent.contentOffset.y > 8 && !didScroll) setDidScroll(true);
          }}
          scrollEventThrottle={16}
        >
          <View style={styles.topContent}>
            <Card style={isDark ? { ...styles.scannerCard, backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted } : styles.scannerCard} variant={isDark ? 'elevated' : 'default'}>
              <View style={styles.scannerHeader}>
                <View style={[styles.iconContainer, { backgroundColor: colors.primary }]}>
                  <AppIcon name="manage-search" color="#FFFFFF" size={24} />
                </View>
                <View style={styles.scannerTextContainer}>
                  <Text style={[styles.scannerTitle, { color: colors.text }]}>스마트 스캐너</Text>
                  <Text style={[styles.scannerDesc, { color: colors.textSecondary }]}>음식/성분표 사진을 찍으면 AI가 정리해드려요.</Text>
                </View>
              </View>
            </Card>

            {showScrollHint ? (
              <View style={styles.scrollHintRow}>
                <Text style={[styles.scrollHintText, { color: colors.textGray }]}>아래로 스크롤해 더 보기</Text>
                <AppIcon name="expand-more" size={18} color={colors.textGray} />
              </View>
            ) : null}

            <Card style={styles.infoCard} variant="elevated">
              <View style={styles.cardTitleRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>무엇을 찍으면 되나요?</Text>
                <TouchableOpacity onPress={handleTips} style={[styles.tipButton, { backgroundColor: colors.warningSoft, borderColor: colors.yellow200 }]}>
                  <AppIcon name="lightbulb" color="#FFD700" size={20} />
                  <Text style={[styles.tipText, { color: colors.warningDark }]}>Tip</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.tagRow}>
                <Badge variant="outline" text="밝은 조명" />
                <Badge variant="outline" text="선명한 초점" />
                <Badge variant="outline" text="전체가 보이게" />
              </View>
              <View style={styles.quickList}>
                <Text style={[styles.quickItem, { color: colors.textSecondary }]}>• 음식 사진(전체가 보이게)</Text>
                <Text style={[styles.quickItem, { color: colors.textSecondary }]}>• 영양성분표/원재료명(글자 선명하게)</Text>
              </View>
            </Card>

            <Card style={styles.infoCard} variant="elevated">
              <View ref={scanButtonFixedRef} onLayout={measureScanButton}>
                <Button
                  title="사진 촬영하기"
                  onPress={handleScanFromTutorial}
                  style={styles.scanButton}
                  icon={<AppIcon name="photo-camera" color={isDark ? colors.text : '#FFFFFF'} size={20} />}
                />
              </View>

              <View style={{ height: 12 }} />

              <Button
                title="라이브러리에서 가져오기"
                onPress={handleGallery}
                variant="outline"
                style={styles.scanButton}
                icon={<AppIcon name="photo-library" color={isDark ? colors.text : colors.primary} size={20} />}
              />
            </Card>

            {recentLogs.length > 0 ? (
              <Card style={{ ...styles.infoCard, ...styles.recentCardWide }} variant="elevated">
                <View style={styles.cardTitleRow}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>최근 기록</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const nav: any = navigation as any;
                      const rootNav = nav?.getParent?.() ?? nav;
                      rootNav.navigate('History');
                    }}
                    style={[
                      styles.tipButton,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : colors.warningSoft,
                        borderColor: isDark ? colors.border : colors.yellow200,
                      },
                    ]}
                  >
                    <Text style={[styles.tipText, { color: isDark ? colors.text : colors.warningDark }]}>전체보기</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.recentList}>
                  {recentLogs.map((log) => {
                    const dish = String(log?.analysis?.dishName ?? '').trim() || '기록';
                    const imageUri = String(log?.imageUri ?? '').trim();
                    const canShowRemoteImage = Boolean(imageUri) && !(isOffline && /^https?:\/\//i.test(imageUri));

                    return (
                      <TouchableOpacity
                        key={log.id}
                        style={[styles.recentRow, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}
                        onPress={() => {
                          const nav: any = navigation as any;
                          const rootNav = nav?.getParent?.() ?? nav;
                          rootNav.navigate('Result', { analysis: log.analysis, imageUri: log.imageUri, readOnly: true });
                        }}
                      >
                        {canShowRemoteImage ? (
                          <Image source={{ uri: imageUri }} style={styles.recentThumb} />
                        ) : (
                          <View style={[styles.recentThumb, styles.recentThumbOffline, { borderColor: colors.border, backgroundColor: colors.background }]}>
                            <Text style={[styles.recentThumbOfflineText, { color: colors.textSecondary }]}>
                              {isOffline ? '오프라인' : '이미지 없음'}
                            </Text>
                          </View>
                        )}
                        <View style={styles.recentTextCol}>
                          <Text style={[styles.recentTitle, { color: colors.text }]} numberOfLines={1}>
                            {dish}
                          </Text>
                          <Text style={[styles.recentSub, { color: colors.textGray }]} numberOfLines={1}>
                            {formatTime(log.timestamp)}
                          </Text>
                        </View>
                        <AppIcon name="chevron-right" size={20} color={colors.textGray} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Card>
            ) : null}

            <Card style={styles.infoCard} variant="elevated">
              <View style={styles.cardTitleRow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>이번 달 스캔</Text>
              </View>
              {isLoggedIn ? (
                <View style={styles.quotaRow}>
                  <Text style={[styles.quotaText, { color: colors.text }]}>
                    남은 횟수: {Math.max(0, monthlyScanLimit - (monthlyUsed ?? 0))}회 / {monthlyScanLimit}회
                  </Text>
                  <Text style={[styles.quotaSubText, { color: colors.textGray }]}>월 단위로 초기화돼요.</Text>
                </View>
              ) : (
                <Text style={[styles.quickItem, { color: colors.textSecondary }]}>로그인하면 이번 달 남은 스캔 횟수가 표시돼요.</Text>
              )}
            </Card>
          </View>
        </ScrollView>
      </View>

      <Modal transparent visible={showTutorial} animationType="fade">
        <View style={styles.tutorialModalRoot} onLayout={measureScanButton}>
          <View style={[styles.tutorialModalTopRow, { paddingTop: tutorialTop }]}>
            <Text style={styles.tutorialTopLabel} accessibilityRole="text">
              사용 가이드
            </Text>
            <TouchableOpacity onPress={finalizeTutorial} accessibilityRole="button" style={styles.tutorialSkip}>
              <Text style={styles.tutorialSkipText}>건너뛰기</Text>
            </TouchableOpacity>
          </View>

          {!!scanButtonRect && (
            <>
              {(() => {
                const highlightPadding = 6;
                const holeX = scanButtonRect.x - highlightPadding;
                const holeY = scanButtonRect.y - highlightPadding;
                const holeW = scanButtonRect.width + highlightPadding * 2;
                const holeH = scanButtonRect.height + highlightPadding * 2;
                const holeR = RADIUS.sm + highlightPadding;

                return (
                  <>
                    {/* Absorb touches everywhere by default */}
                    <TouchableOpacity
                      activeOpacity={1}
                      onPress={() => {}}
                      style={styles.tutorialTouchAbsorber}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />

                    {/* Dim layer with rounded cutout */}
                    <Svg
                      pointerEvents="none"
                      width={screenWidth}
                      height={screenHeight}
                      style={styles.tutorialDimSvg}
                    >
                      <Defs>
                        <Mask id="scanCutoutMask">
                          <Rect width="100%" height="100%" fill="white" />
                          <Rect x={holeX} y={holeY} width={holeW} height={holeH} rx={holeR} ry={holeR} fill="black" />
                        </Mask>
                      </Defs>
                      <Rect
                        width="100%"
                        height="100%"
                        fill="rgba(0,0,0,0.35)"
                        mask="url(#scanCutoutMask)"
                      />
                    </Svg>

                    {/* Highlight frame */}
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

                    {/* Arrow + text */}
                    <View
                      pointerEvents="none"
                      style={[
                        styles.tutorialHint,
                        {
                          left: Math.max(16, scanButtonRect.x + scanButtonRect.width / 2 - 130),
                          top: Math.max(tutorialTop + 10, scanButtonRect.y - 78),
                        },
                      ]}
                    >
                      <Text style={styles.tutorialHintText}>여기를 눌러 음식 사진을 찍고 분석해요</Text>
                      <Text style={styles.tutorialArrow}>↓</Text>
                    </View>

                    {/* Click-through area for CTA: call the same handler as the existing button */}
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={handleScanFromTutorial}
                      style={[
                        styles.tutorialCtaHitbox,
                        {
                          left: scanButtonRect.x - 10,
                          top: scanButtonRect.y - 10,
                          width: scanButtonRect.width + 20,
                          height: scanButtonRect.height + 20,
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
  container: { flex: 1, backgroundColor: COLORS.backgroundGray },
  header: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  offlineBanner: {
    backgroundColor: COLORS.background,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  offlineBannerText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  scrollInner: {
    paddingBottom: 16,
  },
  topContent: { gap: SPACING.md },

  scrollHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scrollHintText: {
    fontSize: 12,
    color: COLORS.textGray,
    fontWeight: '600',
  },
  
  // Scanner Card
  scannerCard: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.blue50,
    borderColor: COLORS.blue200,
  },
  scannerHeader: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xs },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerTextContainer: { flex: 1 },
  scannerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  scannerDesc: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  scanButton: { width: '100%' },

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
  tutorialModalTopRow: {
    paddingHorizontal: SPACING.md,
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
    borderRadius: RADIUS.full,
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

  // Info Card
  infoCard: { padding: SPACING.lg },
  recentCardWide: { marginHorizontal: -8 },
  cardTitleRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  tipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.warningSoft,
    borderWidth: 1,
    borderColor: COLORS.yellow200,
  },
  tipText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.warningDark,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm },
  quickList: { gap: 4 },
  quickItem: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 },

  quotaRow: { marginTop: 6 },
  quotaText: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  quotaSubText: { marginTop: 4, fontSize: 12, color: COLORS.textGray },

  recentList: { gap: 10 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundGray,
  },
  recentThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.border },
  recentThumbOffline: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  recentThumbOfflineText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  recentTextCol: { flex: 1, marginLeft: 12 },
  recentTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  recentSub: { marginTop: 2, fontSize: 12, color: COLORS.textGray },
});
