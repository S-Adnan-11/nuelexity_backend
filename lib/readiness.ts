import { AppError } from "./errors.js";
import type { Store } from "./types.js";

// A burst of clients shares one bounded read. Failed storage never becomes ready.
export function createReadiness(store: Store, timeoutMs = 2500, successMs = 30000, failureMs = 5000) {
  let pending: Promise<void> | undefined;
  let cached: { until: number; failure?: AppError } | undefined;
  return function ready(): Promise<void> {
    if (pending) return pending;
    if (cached && cached.until > Date.now())
      return cached.failure ? Promise.reject(cached.failure) : Promise.resolve();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Readiness deadline")); }, timeoutMs);
    });
    pending = Promise.race([Promise.resolve().then(() => store.ready(controller.signal)), deadline])
      .then(() => { cached = { until: Date.now() + successMs }; })
      .catch(() => {
        const failure = new AppError(503, "READINESS_UNAVAILABLE", "The service cannot access its required storage. Please try again shortly.", 5);
        cached = { until: Date.now() + failureMs, failure };
        throw failure;
      })
      .finally(() => { clearTimeout(timer); controller.abort(); pending = undefined; });
    return pending;
  };
}
