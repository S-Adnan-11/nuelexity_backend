import type { Response } from 'express';

// Stop pulling the provider while a slow client drains. The request deadline
// and close signal bound this wait too; no background stream may keep running.
export async function writeEvent(res: Response, signal: AbortSignal, event: string, data: unknown) {
  signal.throwIfAborted();
  if (res.destroyed) throw new Error('Stream closed');
  if (res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('drain', drain); res.off('close', close); signal.removeEventListener('abort', abort); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new Error('Stream closed')); };
    const abort = () => { cleanup(); reject(signal.reason); };
    res.once('drain', drain);
    res.once('close', close);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (res.destroyed) close();
  });
}
