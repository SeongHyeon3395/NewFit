export type IdleTaskHandle = {
  cancel: () => void;
};

export function runWhenIdle(task: () => void, timeoutMs = 200): IdleTaskHandle {
  const g = globalThis as any;

  if (typeof g.requestIdleCallback === 'function') {
    const id = g.requestIdleCallback(() => {
      task();
    });

    return {
      cancel: () => {
        if (typeof g.cancelIdleCallback === 'function') {
          g.cancelIdleCallback(id);
        }
      },
    };
  }

  const id = setTimeout(task, timeoutMs);
  return {
    cancel: () => clearTimeout(id),
  };
}
