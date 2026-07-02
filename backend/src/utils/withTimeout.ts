export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function withTimeoutFallback<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label = 'operation'
): Promise<T> {
  try {
    return await withTimeout(promise, ms, label);
  } catch (err) {
    console.warn(`[withTimeoutFallback] ${label}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}
