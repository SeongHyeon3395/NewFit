type TutorialPhase = 'verify' | null;

type TutorialState = {
  seen: boolean;
  pending: boolean;
  phase: TutorialPhase;
};

const tutorialState = new Map<string, TutorialState>();

function keyForUser(userId?: string | null) {
  return String(userId || 'anonymous');
}

function ensureState(userId?: string | null): TutorialState {
  const key = keyForUser(userId);
  const existing = tutorialState.get(key);
  if (existing) return existing;

  const next: TutorialState = {
    seen: false,
    pending: false,
    phase: null,
  };
  tutorialState.set(key, next);
  return next;
}

export function getScanTutorialState(userId?: string | null): TutorialState {
  const state = ensureState(userId);
  return { ...state };
}

export function markScanTutorialPending(userId?: string | null) {
  const key = keyForUser(userId);
  const state = ensureState(userId);
  tutorialState.set(key, {
    ...state,
    pending: true,
    seen: false,
    phase: null,
  });
}

export function markScanTutorialVerifyPhase(userId?: string | null) {
  const key = keyForUser(userId);
  const state = ensureState(userId);
  tutorialState.set(key, {
    ...state,
    pending: true,
    phase: 'verify',
  });
}

export function completeScanTutorial(userId?: string | null) {
  const key = keyForUser(userId);
  const state = ensureState(userId);
  tutorialState.set(key, {
    ...state,
    seen: true,
    pending: false,
    phase: null,
  });
}

export function clearScanTutorialState(userId?: string | null) {
  tutorialState.delete(keyForUser(userId));
}
