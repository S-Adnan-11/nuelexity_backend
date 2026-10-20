import { z } from "zod";
import type { Message, Source } from "./types.js";

export const FOLLOW_UP_MARKER = "<|nuelexity_follow_ups_v1|>";
const prefix = "<|nuelexity";
const metadataLimit = 2048;

// Hold possible marker prefixes across chunks. Once metadata starts, nothing
// after it can become answer text, even if its JSON is malformed or truncated.
export class AnswerSections {
  private pending = "";
  private metadata = "";
  private hidden = false;
  private overflow = false;
  private boundary = false;
  get hasAnswerBoundary() { return this.boundary; }
  push(chunk: string): string {
    if (this.hidden) { this.append(chunk); return ""; }
    this.pending += chunk;
    const lower = this.pending.toLowerCase();
    const start = lower.indexOf(prefix);
    if (start >= 0) {
      const answer = this.pending.slice(0, start);
      this.hidden = true;
      this.append(this.pending.slice(start));
      this.pending = "";
      return answer;
    }
    let held = Math.min(prefix.length - 1, this.pending.length);
    while (held && !prefix.startsWith(lower.slice(-held))) held--;
    const text = this.pending.slice(0, this.pending.length - held);
    this.pending = this.pending.slice(this.pending.length - held);
    return text;
  }
  private append(value: string) {
    if (this.overflow) return;
    this.boundary ||= (this.metadata + value).slice(0, FOLLOW_UP_MARKER.length).toLowerCase() === FOLLOW_UP_MARKER;
    if (this.metadata.length + value.length > metadataLimit) {
      this.metadata = "";
      this.overflow = true;
    } else this.metadata += value;
  }
  suggestions(query: string, answer: string, sources: Source[], history: Message[]): string[] {
    if (this.overflow || !this.metadata.toLowerCase().startsWith(FOLLOW_UP_MARKER)) return [];
    try {
      return validateFollowUps(JSON.parse(this.metadata.slice(FOLLOW_UP_MARKER.length)), query, answer, sources, history);
    } catch { return []; }
  }
}

const payloadSchema = z.object({ questions: z.array(z.unknown()).max(3) }).strict();
const questionSchema = z.object({
  question: z.string().trim().min(12).max(160),
  anchor: z.string().trim().min(3).max(64),
}).strict();
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const genericAnchors = new Set(["question", "answer", "source", "sources", "evidence", "example", "explanation", "information", "research", "topic", "details"]);

export function validateFollowUps(payload: unknown, query: string, answer: string, sources: Source[], history: Message[]) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || !sources.length || !answer.trim()) return [];
  if (/insufficient evidence|not enough evidence|evidence is (?:insufficient|conflicting)|preuves (?:insuffisantes|contradictoires)|evidencia insuficiente/i.test(answer)) return [];
  // Grounding is a conservative text check, not a second semantic/model call.
  // The generation instructions handle meaning; uncertain entries are omitted.
  const context = normalize([query, answer, ...sources.map(s => `${s.title} ${s.snippet}`),
    ...history.filter(m => m.status === "complete").slice(-6).map(m => m.content.slice(0, 1000))].join("\n"));
  const asked = new Set([query, ...history.filter(m => m.role === "user").slice(-6).map(m => m.content)].map(normalize));
  const seen = new Set<string>();
  return parsed.data.questions.flatMap(entry => {
    const valid = questionSchema.safeParse(entry);
    if (!valid.success) return [];
    const { question, anchor } = valid.data;
    const key = normalize(question), grounding = normalize(anchor);
    if (!grounding || genericAnchors.has(grounding) || !context.includes(grounding) || !key.includes(grounding) ||
        asked.has(key) || seen.has(key) || normalize(answer).includes(key) ||
        /[<>`\r\n\u0000-\u001f]|https?:\/\/|\]\(/i.test(question) ||
        /^(?:what are the key facts about|what do other sources say about|explain .+ in simpler terms)/i.test(question)) return [];
    // Catch near-duplicates that differ only in a short introductory phrase.
    const words = new Set(key.split(" "));
    if ([...seen].some(previous => {
      const other = new Set(previous.split(" "));
      const common = [...words].filter(word => other.has(word)).length;
      return common / Math.max(words.size, other.size) > .8;
    })) return [];
    seen.add(key);
    return [question];
  });
}
