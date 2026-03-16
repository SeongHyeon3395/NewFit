import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import NetInfo, { useNetInfo } from '@react-native-community/netinfo';
import { COLORS, RADIUS, SPACING } from '../../constants/colors';
import { AppIcon } from '../../components/ui/AppIcon';
import { MainShortcutBar } from '../../components/ui/MainShortcutBar';
import { chatHealth, type HealthChatMessage } from '../../services/api';
import {
  deleteMyHealthChatMessagesRemote,
  fetchMyHealthChatMessagesRemote,
  getMonthlyChatTokenStatusRemote,
  getMyAvatarSignedUrl,
  getSessionUserId,
  upsertMyHealthChatMessagesRemote,
} from '../../services/userData';
import { useAppAlert } from '../../components/ui/AppAlert';
import { captureError, logEvent } from '../../services/telemetry';
import { retryAsync } from '../../services/retry';
import { useUserStore } from '../../store/userStore';
import { useTheme } from '../../theme/ThemeProvider';

type ChatRole = 'user' | 'assistant';

type ChatItem = {
  id: string;
  role: ChatRole;
  text: string;
  pending?: boolean;
};

function TypingDots() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d >= 3 ? 1 : d + 1));
    }, 220);
    return () => clearInterval(id);
  }, []);

  return (
    <Text style={styles.thinkingText}>
      {'.'.repeat(dots)}
    </Text>
  );
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function ChatScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const listRef = useRef<FlatList<ChatItem> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingAssistantIdRef = useRef<string | null>(null);
  const prefillHandledRef = useRef(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteSyncInFlightRef = useRef(false);

  const profile = useUserStore((s) => s.profile);
  const { alert } = useAppAlert();
  const { colors } = useTheme();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const [items, setItems] = useState<ChatItem[]>([
    {
      id: makeId(),
      role: 'assistant',
      text: '안녕하세요! 식단/운동/생활습관에 대해 편하게 물어보세요.\n개인 맞춤으로 도와드릴게요.',
    },
  ]);
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<null | { remaining: number; limit: number; used: number; planId: string }>(null);

  const net = useNetInfo();
  const isOffline = net.isConnected === false || net.isInternetReachable === false;
  const isOnline = !isOffline;
  const isTokenExhausted = typeof tokenStatus?.remaining === 'number' && tokenStatus.remaining <= 0;

  const resetToMainTab = React.useCallback(
    (screen: 'Scan' | 'Meal' | 'Calendar' | 'Profile') => {
      const parentNav = navigation.getParent?.();
      const rootNav = parentNav?.getParent?.() ?? parentNav ?? navigation;
      rootNav.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'MainTab', params: { screen } }],
        })
      );
    },
    [navigation]
  );

  const historyForApi: HealthChatMessage[] = useMemo(() => {
    // Keep it short to control token usage
    const last = items.slice(-12);
    return last.map((m) => ({ role: m.role, text: m.text }));
  }, [items]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!profile?.avatarPath) {
          if (mounted) setAvatarUrl(null);
          return;
        }
        const url = await getMyAvatarSignedUrl().catch(() => null);
        if (mounted) setAvatarUrl(url);
      } catch {
        if (mounted) setAvatarUrl(null);
      }
    })();

    return () => {
      mounted = false;
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }

      if (cursorTimerRef.current) {
        clearInterval(cursorTimerRef.current);
        cursorTimerRef.current = null;
      }
    };
  }, [profile?.avatarPath]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const userId = await getSessionUserId().catch(() => null);
      if (!mounted) return;
      setSessionUserId(userId);

      // 로그인 상태면 원격 대화 복원
      if (userId) {
        try {
          const remote = await retryAsync(() => fetchMyHealthChatMessagesRemote(250), { retries: 1, delayMs: 700 });
          if (Array.isArray(remote) && remote.length > 0) {
            const next: ChatItem[] = remote.map((r: any) => ({
              id: String(r?.id),
              role: (String(r?.role) === 'user' ? 'user' : 'assistant') as ChatRole,
              text: String(r?.content ?? ''),
            }));
            setItems(next);
          }
        } catch {
          // ignore
        }

        try {
          const status = await retryAsync(() => getMonthlyChatTokenStatusRemote(), { retries: 1, delayMs: 700 });
          if (mounted && status) {
            setTokenStatus({
              remaining: Number(status.remaining || 0),
              limit: Number(status.limit_value || 0),
              used: Number(status.used || 0),
              planId: String(status.plan_id || 'free'),
            });
          }
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      mounted = false;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!sessionUserId) return;
      try {
        const status = await retryAsync(() => getMonthlyChatTokenStatusRemote(), { retries: 1, delayMs: 700 });
        if (!mounted || !status) return;
        setTokenStatus({
          remaining: Number(status.remaining || 0),
          limit: Number(status.limit_value || 0),
          used: Number(status.used || 0),
          planId: String(status.plan_id || 'free'),
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, [sessionUserId, profile?.plan_id]);

  useEffect(() => {
    const hasPending = items.some((m) => Boolean(m?.pending));

    // 타이핑 애니메이션/펜딩 중에는 원격 저장을 미뤄서 write 폭주를 방지
    if (hasPending) return;
    if (typingAssistantIdRef.current) return;

    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      (async () => {
        if (!sessionUserId) return;
        if (remoteSyncInFlightRef.current) return;
        remoteSyncInFlightRef.current = true;
        try {
          const trimmed = items.slice(-200).filter((m) => m && !m.pending);
          await upsertMyHealthChatMessagesRemote(trimmed.map((m) => ({ id: m.id, role: m.role, content: m.text })));
        } catch {
          // ignore
        } finally {
          remoteSyncInFlightRef.current = false;
        }
      })();
    }, 650);

    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, [items, sessionUserId]);

  const scrollToEnd = (animated = false) => {
    // 타이핑 중에는 animated 스크롤을 계속 호출하면 화면이 꾸물거리듯 내려가므로 기본은 즉시 이동
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  };

  const sendMessage = async (rawMessage: string, clearInput: boolean) => {
    const message = rawMessage.trim();
    if (!message || isSending) return;

    // 오프라인일 때는 즉시 안내 후 중단
    if (!isOnline) {
      alert({
        title: '인터넷 연결 필요',
        message: '현재 오프라인 상태라 챗봇을 사용할 수 없어요.\n인터넷 연결 후 다시 시도해주세요.',
      });
      return;
    }

    if (isTokenExhausted) {
      alert({
        title: '토큰 소진',
        message: '이번 달 챗봇 토큰을 모두 사용했어요. 플랜 업그레이드 후 다시 이용해주세요.',
      });
      return;
    }

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (cursorTimerRef.current) {
      clearInterval(cursorTimerRef.current);
      cursorTimerRef.current = null;
    }
    typingAssistantIdRef.current = null;
    setCursorVisible(true);

    const userItem: ChatItem = { id: makeId(), role: 'user', text: message };
    setItems((prev) => [...prev, userItem]);
    if (clearInput) setText('');
    setIsSending(true);

    const assistantId = makeId();
    setItems((prev) => [...prev, { id: assistantId, role: 'assistant', text: '', pending: true }]);

    try {
      scrollToEnd(false);

      const userContext = profile
        ? {
            nickname: profile.nickname || profile.username || undefined,
            bodyGoal: (profile as any).bodyGoal,
            healthDiet: (profile as any).healthDiet,
            lifestyleDiet: (profile as any).lifestyleDiet,
            allergens: (profile as any).allergens,
            currentWeight: (profile as any).currentWeight,
            targetWeight: (profile as any).targetWeight,
            height: (profile as any).height,
            age: (profile as any).age,
            gender: (profile as any).gender,
          }
        : null;

      const res = await chatHealth({ message, history: historyForApi, userContext });
      const reply = String(res?.data?.reply || res?.reply || '').trim();
      const finalText = reply || '답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.';

      if (res?.data?.token) {
        setTokenStatus((prev) => ({
          remaining: Number((res as any)?.data?.token?.remaining ?? prev?.remaining ?? 0),
          limit: Number((res as any)?.data?.token?.limit ?? prev?.limit ?? 0),
          used: Number((res as any)?.data?.token?.used ?? prev?.used ?? 0),
          planId: String((res as any)?.data?.token?.planId ?? prev?.planId ?? 'free'),
        }));
      }

      logEvent('chat_health_success');

      setItems((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: false, text: '' } : m)));

      typingAssistantIdRef.current = assistantId;
      setCursorVisible(true);
      cursorTimerRef.current = setInterval(() => {
        setCursorVisible((v) => !v);
      }, 420);

      const chars = Array.from(finalText);
      let i = 0;
      typingTimerRef.current = setInterval(() => {
        i += 1;
        const slice = chars.slice(0, i).join('');
        setItems((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: slice } : m)));
        scrollToEnd(false);
        if (i >= chars.length) {
          if (typingTimerRef.current) {
            clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }

          typingAssistantIdRef.current = null;
          if (cursorTimerRef.current) {
            clearInterval(cursorTimerRef.current);
            cursorTimerRef.current = null;
          }
          setCursorVisible(false);
        }
      }, 18);
    } catch (e: any) {
      captureError(e, { screen: 'ChatScreen', action: 'chatHealth' });
      logEvent('chat_health_error');

      const raw = String(e?.message || e || '').trim();
      const low = raw.toLowerCase();
      const friendly =
        low.includes('timeout') || low.includes('aborted') || low.includes('abort')
          ? '서버가 바빠요. 잠시 후 다시 눌러주세요.'
          : low.includes('token') && low.includes('소진')
            ? '이번 달 챗봇 토큰을 모두 사용했어요. 플랜 업그레이드 후 다시 이용해주세요.'
          : low.includes('network') || low.includes('failed to fetch')
            ? '네트워크가 불안정해요. 연결 확인 후 다시 시도해주세요.'
            : raw || 'UNKNOWN_ERROR';

      setItems((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                text: `오류가 발생했어요.\n${friendly}`,
              }
            : m
        )
      );
    } finally {
      setIsSending(false);
      scrollToEnd(false);
    }
  };

  const handleSend = () => {
    void sendMessage(text, true);
  };

  const startNewChat = async () => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (cursorTimerRef.current) {
      clearInterval(cursorTimerRef.current);
      cursorTimerRef.current = null;
    }
    typingAssistantIdRef.current = null;
    setCursorVisible(false);

    const greeting: ChatItem[] = [
      {
        id: makeId(),
        role: 'assistant',
        text: '안녕하세요! 식단/운동/생활습관에 대해 편하게 물어보세요.\n개인 맞춤으로 도와드릴게요.',
      },
    ];

    setItems(greeting);
    setText('');

    if (sessionUserId) {
      try {
        await deleteMyHealthChatMessagesRemote();
      } catch {
        // ignore
      }
    }
  };

  const confirmNewChat = () => {
    alert({
      title: '새 채팅',
      message: '새 채팅을 시작하면 기존 대화 내용이 삭제됩니다.',
      actions: [
        {
          text: '새 채팅+',
          variant: 'primary',
          onPress: () => {
            void startNewChat();
          },
        },
        { text: '취소', variant: 'outline' },
      ],
    });
  };

  useEffect(() => {
    const prefillMessage = String(route?.params?.prefillMessage || '').trim();
    const autoSend = Boolean(route?.params?.autoSend);
    if (!prefillMessage || prefillHandledRef.current) return;
    prefillHandledRef.current = true;

    if (autoSend) {
      // Do not leave text in the input; send directly and clear input.
      setText('');
      void sendMessage(prefillMessage, true);
      return;
    }

    setText(prefillMessage);
  }, [route?.params, isSending]);

  const renderItem = ({ item }: { item: ChatItem }) => {
    const isUser = item.role === 'user';
    const isTyping = !item.pending && item.id === typingAssistantIdRef.current;
    const cursor = isTyping && cursorVisible ? '▍' : '';
    return (
      <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
        {!isUser ? (
          <View style={[styles.avatarBot, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}>
            <AppIcon name="smart-toy" size={18} color={colors.primary} />
          </View>
        ) : null}

        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.assistantBubble,
            !isUser && { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted },
          ]}
        >
          {item.pending ? (
            <TypingDots />
          ) : (
            <Text style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText, !isUser && { color: colors.text }]}>
              {item.text}
              {cursor}
            </Text>
          )}
        </View>

        {isUser ? (
          <View style={[styles.avatarUser, { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <AppIcon name="person" size={18} color={colors.textSecondary} />
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const handleBackPress = () => {
    resetToMainTab('Profile');
  };

  useFocusEffect(
    React.useCallback(() => {
      const onBack = () => {
        handleBackPress();
        return true;
      };

      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [resetToMainTab])
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.backgroundGray }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={handleBackPress}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="뒤로가기"
        >
          <AppIcon name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>헬스케어 AI</Text>
        <TouchableOpacity
          onPress={confirmNewChat}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="새 채팅 시작"
        >
          <AppIcon name="add" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {!isOnline ? (
        <View style={[styles.offlineBanner, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.offlineBannerText, { color: colors.textSecondary }]}>
            오프라인 상태예요. 챗봇은 인터넷 연결 후 사용 가능합니다.
          </Text>
        </View>
      ) : null}

      {isOnline && isTokenExhausted ? (
        <View style={[styles.offlineBanner, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.offlineBannerText, { color: colors.textSecondary }]}>
            이번 달 챗봇 토큰을 모두 사용했어요. 플랜 업그레이드 후 다시 이용해주세요.
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={(r) => {
            listRef.current = r;
          }}
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => scrollToEnd(false)}
          showsVerticalScrollIndicator={false}
        />

        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.inputWrap}>
            <TextInput
              style={[styles.input, { borderColor: colors.surfaceMuted, backgroundColor: colors.surfaceElevated, color: colors.text }]}
              value={text}
              onChangeText={setText}
              placeholder={
                !isOnline
                  ? '오프라인 상태예요. 인터넷 연결 후 다시 시도해주세요.'
                  : isTokenExhausted
                    ? '이번 달 토큰이 소진되어 채팅을 보낼 수 없어요.'
                    : '예) 오늘 점심 뭐 먹을까요?'
              }
              placeholderTextColor={colors.textSecondary}
              multiline
              editable={!isTokenExhausted}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={isSending || text.trim().length === 0 || !isOnline || isTokenExhausted}
              style={[
                styles.sendButton,
                { backgroundColor: colors.surfaceElevated, borderColor: colors.surfaceMuted },
                (isSending || text.trim().length === 0 || !isOnline || isTokenExhausted) && styles.sendButtonDisabled,
              ]}
            >
              {isSending ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <AppIcon name="send" color={colors.text} size={18} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      <MainShortcutBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundGray,
  },
  header: {
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
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
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  rowLeft: {
    justifyContent: 'flex-start',
  },
  rowRight: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  assistantBubble: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  userBubble: {
    backgroundColor: COLORS.primary,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  assistantText: {
    color: COLORS.text,
  },
  userText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  thinkingText: {
    fontSize: 18,
    lineHeight: 20,
    color: COLORS.textSecondary,
    fontWeight: '800',
    letterSpacing: 1,
  },
  avatarBot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUser: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 32,
    height: 32,
  },
  composer: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundGray,
    color: COLORS.text,
    fontSize: 14,
    lineHeight: 18,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
