import { afterEach, expect, test, vi } from "vitest";
import { createReadiness } from "../lib/readiness.js";
import type { Store } from "../lib/types.js";

afterEach(() => vi.useRealTimers());
test("slow readiness is shared, cached and bounded, including a failed dependency", async () => {
  vi.useFakeTimers();
  let calls = 0, signal: AbortSignal | undefined;
  let complete!: () => void;
  const store = { ready: (s?: AbortSignal) => {
    calls++; signal = s; return new Promise<void>(resolve => { complete = resolve; });
  } } as Store;
  const ready = createReadiness(store, 100, 300, 50);
  const first = ready(), same = ready();
  expect(first).toBe(same);
  await Promise.resolve(); complete();
  await first; await ready(); expect(calls).toBe(1);
  await vi.advanceTimersByTimeAsync(301);
  const failed = ready();
  const rejection = expect(failed).rejects.toMatchObject({ code: "READINESS_UNAVAILABLE" });
  await vi.advanceTimersByTimeAsync(100); await rejection;
  expect(signal?.aborted).toBe(true);
  await expect(ready()).rejects.toMatchObject({ code: "READINESS_UNAVAILABLE" });
  expect(calls).toBe(2);
  await vi.advanceTimersByTimeAsync(51);
  const recovery = ready(); await Promise.resolve(); complete(); await recovery;
  expect(calls).toBe(3);
});
