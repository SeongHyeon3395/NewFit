import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, FoodLog, BodyLog, ManualMealLog } from '../types/user';
import { getSessionUserId, updateMyAppUser } from '../services/userData';

interface UserState {
  profile: UserProfile | null;
  foodLogs: FoodLog[];
  bodyLogs: BodyLog[];
  manualMealLogs: ManualMealLog[];
  
  // Actions
  setProfile: (profile: UserProfile) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  loadProfile: () => Promise<void>;
  clearProfile: () => Promise<void>;
  clearAllData: () => Promise<void>;
  
  addFoodLog: (log: FoodLog) => Promise<void>;
  loadFoodLogs: () => Promise<void>;
  setFoodLogs: (logs: FoodLog[]) => Promise<void>;
  
  addBodyLog: (log: BodyLog) => Promise<void>;
  loadBodyLogs: () => Promise<void>;
  setBodyLogs: (logs: BodyLog[]) => Promise<void>;

  addManualMealLog: (log: ManualMealLog) => Promise<void>;
  updateManualMealLog: (id: string, updates: Partial<ManualMealLog>) => Promise<void>;
  removeManualMealLog: (id: string) => Promise<void>;
  loadManualMealLogs: () => Promise<void>;
  setManualMealLogs: (logs: ManualMealLog[]) => Promise<void>;
}

const PROFILE_KEY = '@nutrimatch_profile';
const FOOD_LOGS_KEY = '@nutrimatch_food_logs';
const BODY_LOGS_KEY = '@nutrimatch_body_logs';
const MANUAL_MEAL_LOGS_KEY = '@nutrimatch_manual_meal_logs';

const FOOD_LOGS_MAX = 50;

function scopedKey(base: string, userId?: string | null) {
  return userId ? `${base}:${userId}` : base;
}

function isRemoteHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isLocalDeviceUri(value: unknown): value is string {
  return typeof value === 'string' && /^(file|content):\/\//i.test(value);
}

function mergeFoodLogImageUri(nextImageUri: unknown, prevImageUri: unknown): string {
  const next = typeof nextImageUri === 'string' ? nextImageUri.trim() : '';
  const prev = typeof prevImageUri === 'string' ? prevImageUri.trim() : '';

  if (isRemoteHttpUrl(next)) return next;
  if (next && !isLocalDeviceUri(next)) return next;
  if (!next && prev) return prev;
  if (isLocalDeviceUri(next) && isRemoteHttpUrl(prev)) return prev;
  return next || prev;
}

function mergeFoodLogsWithCachedImages(nextLogs: FoodLog[], currentLogs: FoodLog[]): FoodLog[] {
  const currentMap = new Map(currentLogs.map((log) => [String(log?.id || ''), log]));

  return nextLogs.map((log) => {
    const key = String(log?.id || '');
    const current = currentMap.get(key);
    if (!current) return log;

    const mergedImageUri = mergeFoodLogImageUri(log?.imageUri, current?.imageUri);
    if (mergedImageUri === (log?.imageUri || '')) return log;

    return {
      ...log,
      imageUri: mergedImageUri,
    };
  });
}

function normalizeFoodLogs(logs: FoodLog[]): FoodLog[] {
  const arr = Array.isArray(logs) ? logs.filter(Boolean) : [];
  if (arr.length <= FOOD_LOGS_MAX) return arr;

  const safeTime = (t: any) => {
    const s = typeof t === 'string' ? t : '';
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : 0;
  };

  const sorted = [...arr].sort((a, b) => safeTime(a?.timestamp) - safeTime(b?.timestamp));
  return sorted.slice(-FOOD_LOGS_MAX);
}

async function isRemoteBackedSession() {
  const sessionUserId = await getSessionUserId().catch(() => null);
  return Boolean(sessionUserId);
}

async function clearLocalCollectionCache(baseKey: string, userId?: string | null) {
  await AsyncStorage.multiRemove([baseKey, scopedKey(baseKey, userId)]);
}

async function clearLocalProfileCache() {
  await AsyncStorage.removeItem(PROFILE_KEY);
}

export const useUserStore = create<UserState>((set, get) => ({
  profile: null,
  foodLogs: [],
  bodyLogs: [],
  manualMealLogs: [],
  
  setProfile: async (profile: UserProfile) => {
    await clearLocalProfileCache().catch(() => {
      // ignore
    });
    set({ profile });
  },
  
  updateProfile: async (updates: Partial<UserProfile>) => {
    const current = get().profile;
    if (!current) return;
    
    const updated: UserProfile = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await clearLocalProfileCache().catch(() => {
      // ignore
    });
    set({ profile: updated });

    // 로그인 상태면 서버에도 반영
    try {
      const userId = await getSessionUserId().catch(() => null);
      if (!userId) return;
      const remoteProfile = await updateMyAppUser(updates);
      await clearLocalProfileCache().catch(() => {
        // ignore
      });
      set({ profile: remoteProfile });
    } catch {
      // ignore
    }
  },
  
  loadProfile: async () => {
    try {
      await clearLocalProfileCache().catch(() => {
        // ignore
      });
      set({ profile: null });
    } catch (e) {
      console.error('Failed to load profile', e);
    }
  },
  
  clearProfile: async () => {
    await AsyncStorage.removeItem(PROFILE_KEY);
    set({ profile: null });
  },

  clearAllData: async () => {
    const userId = get().profile?.id;
    const keys = [
      PROFILE_KEY,
      FOOD_LOGS_KEY,
      BODY_LOGS_KEY,
      MANUAL_MEAL_LOGS_KEY,
      scopedKey(FOOD_LOGS_KEY, userId),
      scopedKey(BODY_LOGS_KEY, userId),
      scopedKey(MANUAL_MEAL_LOGS_KEY, userId),
    ];
    await AsyncStorage.multiRemove(keys);
    set({ profile: null, foodLogs: [], bodyLogs: [], manualMealLogs: [] });
  },
  
  addFoodLog: async (log: FoodLog) => {
    const logs = normalizeFoodLogs([...get().foodLogs, log]);
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(FOOD_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(FOOD_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ foodLogs: logs });
  },
  
  loadFoodLogs: async () => {
    try {
      const userId = get().profile?.id;
      if (await isRemoteBackedSession()) {
        await clearLocalCollectionCache(FOOD_LOGS_KEY, userId).catch(() => {
          // ignore
        });
        return;
      }
      const stored = await AsyncStorage.getItem(scopedKey(FOOD_LOGS_KEY, userId));
      if (stored) {
        set({ foodLogs: normalizeFoodLogs(JSON.parse(stored)) });
        return;
      }
      // legacy fallback
      const legacy = await AsyncStorage.getItem(FOOD_LOGS_KEY);
      if (legacy) set({ foodLogs: normalizeFoodLogs(JSON.parse(legacy)) });
    } catch (e) {
      console.error('Failed to load food logs', e);
    }
  },

  setFoodLogs: async (logs: FoodLog[]) => {
    const userId = get().profile?.id;
    const current = Array.isArray(get().foodLogs) ? get().foodLogs : [];
    const next = normalizeFoodLogs(mergeFoodLogsWithCachedImages(logs, current));
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(FOOD_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(FOOD_LOGS_KEY, userId), JSON.stringify(next));
    }
    set({ foodLogs: next });
  },
  
  addBodyLog: async (log: BodyLog) => {
    const logs = [...get().bodyLogs, log];
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(BODY_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(BODY_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ bodyLogs: logs });
  },
  
  loadBodyLogs: async () => {
    try {
      const userId = get().profile?.id;
      if (await isRemoteBackedSession()) {
        await clearLocalCollectionCache(BODY_LOGS_KEY, userId).catch(() => {
          // ignore
        });
        return;
      }
      const stored = await AsyncStorage.getItem(scopedKey(BODY_LOGS_KEY, userId));
      if (stored) {
        set({ bodyLogs: JSON.parse(stored) });
        return;
      }
      // legacy fallback
      const legacy = await AsyncStorage.getItem(BODY_LOGS_KEY);
      if (legacy) set({ bodyLogs: JSON.parse(legacy) });
    } catch (e) {
      console.error('Failed to load body logs', e);
    }
  },

  setBodyLogs: async (logs: BodyLog[]) => {
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(BODY_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(BODY_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ bodyLogs: logs });
  },

  addManualMealLog: async (log: ManualMealLog) => {
    const logs = [...get().manualMealLogs, log];
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(MANUAL_MEAL_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(MANUAL_MEAL_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ manualMealLogs: logs });
  },

  updateManualMealLog: async (id: string, updates: Partial<ManualMealLog>) => {
    const prev = get().manualMealLogs;
    const logs = prev.map((l) => (l.id === id ? { ...l, ...updates } : l));
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(MANUAL_MEAL_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(MANUAL_MEAL_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ manualMealLogs: logs });
  },

  removeManualMealLog: async (id: string) => {
    const prev = get().manualMealLogs;
    const logs = prev.filter((l) => l.id !== id);
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(MANUAL_MEAL_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(MANUAL_MEAL_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ manualMealLogs: logs });
  },

  loadManualMealLogs: async () => {
    try {
      const userId = get().profile?.id;
      if (await isRemoteBackedSession()) {
        await clearLocalCollectionCache(MANUAL_MEAL_LOGS_KEY, userId).catch(() => {
          // ignore
        });
        return;
      }
      const stored = await AsyncStorage.getItem(scopedKey(MANUAL_MEAL_LOGS_KEY, userId));
      if (stored) {
        set({ manualMealLogs: JSON.parse(stored) });
        return;
      }
      // legacy fallback (unscoped)
      const legacy = await AsyncStorage.getItem(MANUAL_MEAL_LOGS_KEY);
      if (legacy) set({ manualMealLogs: JSON.parse(legacy) });
    } catch (e) {
      console.error('Failed to load manual meal logs', e);
    }
  },

  setManualMealLogs: async (logs: ManualMealLog[]) => {
    const userId = get().profile?.id;
    if (await isRemoteBackedSession()) {
      await clearLocalCollectionCache(MANUAL_MEAL_LOGS_KEY, userId).catch(() => {
        // ignore
      });
    } else {
      await AsyncStorage.setItem(scopedKey(MANUAL_MEAL_LOGS_KEY, userId), JSON.stringify(logs));
    }
    set({ manualMealLogs: logs });
  },
}));
