// Limit this check to explicit English point-to-point passenger questions.
export function needsRouteClarification(query: string, excerpts: string[]) {
  const mode = /\b(bus|train|flight|rail)\b/i.exec(query)?.[1]?.toLowerCase();
  if (!mode) return false;
  const route = /\bfrom\s+([\p{L}][\p{L} .’-]{0,60}?)\s+to\s+([\p{L}][\p{L} .’-]{0,60}?)(?=\s+(?:by|in|on|for|using|via)\b|[?!.,]|$)/iu.exec(query);
  if (!route) return false;
  const escape = (place: string) => place.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direction = new RegExp(`\\b${escape(route[1]!)}\\s+(?:to|→|–|-)\\s+${escape(route[2]!)}\\b`, "i");
  const transport = mode === "bus" ? /\b(bus|buses|coach)\b/i : mode === "flight" ? /\b(flights?|flies|airline)\b/i : /\b(train|rail|railway)\b/i;
  return !excerpts.some(excerpt => excerpt.split(/(?<=[.!?])\s+|\n/).some(sentence =>
    direction.test(sentence) && transport.test(sentence) &&
    /\b(runs?|operates?|serves?|departs?|leaves?|scheduled|bookable)\b/i.test(sentence) &&
    !/\b(no|not|never|unconfirmed|proposed|planned|suspended|cancelled|formerly|may|could|whether)\b/i.test(sentence)
  ));
}
