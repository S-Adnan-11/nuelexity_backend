import { AppError } from './errors.js';

export async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError(502, 'INVALID_PROVIDER', 'A service returned an invalid response.');
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AppError(502, 'PROVIDER_LIMIT', 'A service response exceeded its limit.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); }
    catch { throw new AppError(502, 'INVALID_PROVIDER', 'A service returned an invalid response.'); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
