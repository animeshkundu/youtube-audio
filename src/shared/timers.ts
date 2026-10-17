/**
 * Raced-timeout helpers (SPEC-018). The extension's contexts are long-lived (a persistent MV2
 * background, a popup document per open), so a timeout that has already lost its race must not stay
 * armed: both helpers clear their timer the moment the wrapped promise settles, in either
 * direction, and a late settle after the timeout won is a no-op.
 */

/**
 * Resolves with the promise's value, or `fallback` after `ms`. A rejection of the promise is
 * forwarded immediately (with the timer cleared).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Resolves with the promise's value, or rejects with `new Error(message)` after `ms`. A rejection
 * of the promise is forwarded immediately (with the timer cleared).
 */
export function requireWithin<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
