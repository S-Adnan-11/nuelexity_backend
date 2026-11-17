import type { Message, Source } from "./types.js";

export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Remove tracking only for duplicate comparison. Route/date/language parameters
// can change the evidence; keep them and keep the original outgoing URL.
export function sourceKey(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}

export function retrievalQuery(query: string, history: Message[]) {
  const previous = [...history].reverse().find(m => m.role === "user" && m.status === "complete");
  // A new standalone question must not inherit the old topic. Resolve explicit
  // references and short elliptical follow-ups using user context only.
  const reference = /^(?:(?:and )?(?:how|why|when|where|can|could|does|did|is|are|would|will)\b.{0,20}\b(?:it|its|they|their|them|that|those|this)\b|.{0,50}\bthere\b)/i.test(query);
  const elliptical = query.length <= 120 && /^(?:(?:and |what about |how about )(?:[^?.!]+)|(?:by (?:bus|train|air|road)|the (?:cost|price|fare|schedule|sources|evidence)|why|how so))[?.!\s]*$/i.test(query);
  if (!previous || (!reference && !elliptical)) return query;
  const room = 1000 - query.length - 10;
  return room > 0 ? `${query}\nContext: ${previous.content.slice(0, Math.min(400, room))}` : query;
}

export interface SearchCandidate {
  title: string;
  url: string;
  content?: string | null;
  score?: number;
  published_date?: string | null;
}
const stopWords = new Set("a an and are as at be by can do does for from get go how i in is it me of on or the to travel what when where which with".split(" "));
const words = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  .filter(word => word.length > 1 && !stopWords.has(word)))];
const clean = (text: string, length: number) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, length);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function selectSources(query: string, candidates: SearchCandidate[], now = Date.now()): Source[] {
  const terms = words(query.split("\nContext:")[0]!);
  const contextTerms = words(query.split("\nContext:")[1] || "");
  const route = /\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:by|in|on|for|using|via)\b|[?.!\n]|$)/i.exec(query)
    || /^([\p{L} .'-]{2,50})\s+to\s+(.+?)(?=\s+(?:by|in|on|for|using|via)\b|[?.!\n]|$)/iu.exec(query);
  const seen = new Set<string>();
  const ranked = candidates.flatMap((item, index) => {
    const url = safeUrl(item.url);
    if (!url) return [];
    const key = sourceKey(url);
    const title = clean(item.title, 200), snippet = clean(item.content || "", 1500);
    // Score only the text that can actually become evidence. A provider score
    // signals relevance, never truth or current bookable service.
    const text = `${title} ${snippet}`.toLowerCase();
    const tokens = new Set(words(text));
    const coverage = terms.length ? terms.filter(term => tokens.has(term)).length / terms.length : 0;
    const contextCoverage = contextTerms.length ? contextTerms.filter(term => tokens.has(term)).length / contextTerms.length : 0;
    const host = new URL(url).hostname;
    const authority = coverage > 0 && /(?:^|\.)(?:gov(?:\.[a-z]{2})?|edu(?:\.[a-z]{2})?|ac\.[a-z]{2})$/i.test(host) ? 0.2 : 0;
    const timestamp = item.published_date ? Date.parse(item.published_date) : NaN;
    const dated = /\b(current|latest|today|schedule|fare|bus|train|flight)\b/i.test(query);
    const freshness = dated && Number.isFinite(timestamp) && timestamp <= now
      ? Math.max(0, 0.15 * (1 - (now - timestamp) / (365 * 86400000))) : 0;
    // Exact place strings only: no guessed city/state equivalences or detours.
    const direction = route
      ? new RegExp(`${escape(route[1]!.trim())}\\s+(?:to|→|–|-)\\s+${escape(route[2]!.trim())}`, "i").test(title) ? 0.4
        : new RegExp(`${escape(route[2]!.trim())}\\s+(?:to|→|–|-)\\s+${escape(route[1]!.trim())}`, "i").test(title) ? -0.4 : 0
      : 0;
    return [{ title, url, snippet, key, index, rank: coverage * 2 + contextCoverage * 0.4 + (item.score ?? 0) + authority + freshness + direction }];
  });
  return ranked.sort((a, b) => b.rank - a.rank || a.index - b.index).filter(item => {
    if (seen.has(item.key)) return false;
    seen.add(item.key); return true;
  }).slice(0, 5)
    .map(({ title, url, snippet }, index) => ({ id: index + 1, title, url, snippet }));
}

export function combineSources(firstParty: Source[], web: Source[]): Source[] {
  const seen = new Set<string>();
  return [...firstParty, ...web].filter(source => {
    const key = sourceKey(source.url);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 5).map((source, index) => ({ ...source, id: index + 1 }));
}
