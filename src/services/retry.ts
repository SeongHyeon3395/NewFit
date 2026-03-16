export async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryAsync<T>(factory: () => Promise<T>, options?: { retries?: number; delayMs?: number }) {
  const retries = Math.max(0, options?.retries ?? 1);
  const delayMs = Math.max(0, options?.delayMs ?? 500);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await factory();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await wait(delayMs);
    }
  }

  throw lastError;
}
