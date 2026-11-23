/** Call fn until it resolves, at most `attempts` times, waiting `delayMs` between attempts. */
export async function retry(fn, { attempts = 3, delayMs = 0 } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (error) {
      lastError = error;
      if (i < attempts && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
