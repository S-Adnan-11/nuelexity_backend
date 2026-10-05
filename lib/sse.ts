import { AppError } from "./errors";

// Provider packets can split anywhere, including inside JSON or a UTF-8 character.
export async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 65536)
        throw new AppError(502, "INVALID_STREAM", "The answer provider sent an invalid stream.");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const packet = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = packet
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
      if (done) break;
    }
    if (buffer.trim())
      throw new AppError(502, "INCOMPLETE_STREAM", "The answer stream ended unexpectedly.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
