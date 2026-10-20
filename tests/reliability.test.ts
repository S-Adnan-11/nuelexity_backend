import { EventEmitter } from 'node:events';
import type { Response as ExpressResponse } from 'express';
import { test, expect } from 'vitest';
import { writeEvent } from '../lib/backpressure.js';
import { boundedJson } from '../lib/bounded-json.js';
test('SSE waits for drain and removes listeners on cancellation', async () => {
  const res = Object.assign(new EventEmitter(), { destroyed: false, write: () => false });
  const controller = new AbortController();
  let finished = false;
  const pending = writeEvent(res as unknown as ExpressResponse, controller.signal, 'delta', { text: 'hello' }).then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  res.emit('drain'); await pending;
  expect(finished).toBe(true); expect(res.listenerCount('close')).toBe(0);
  const cancelled = writeEvent(res as unknown as ExpressResponse, controller.signal, 'delta', {});
  controller.abort(new Error('cancelled'));
  await expect(cancelled).rejects.toThrow('cancelled');
  expect(res.listenerCount('drain')).toBe(0);
});
test('provider JSON has a byte limit across chunks, closes the reader and hides invalid data', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"private":"'+ 'x'.repeat(60))); }, cancel() { cancelled = true; } }));
  await expect(boundedJson(response, 20)).rejects.toThrow('exceeded its limit');
  expect(cancelled).toBe(true);
  await expect(boundedJson(new Response('private-token'), 100)).rejects.toThrow('invalid response');
  expect(await boundedJson(Response.json({ ok: true }), 100)).toEqual({ ok: true });
});
