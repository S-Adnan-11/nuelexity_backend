import { evidencePassages } from "./excerpt.js";

const inactive = /\b(cancelled|canceled|suspended|withdrawn|discontinued|expired|ceased|no longer|last (?:ran|operated)|out of service)\b/i;
const travelDate = /\b(?:today|tonight|tomorrow|yesterday|(?:this|next|last) (?:week|weekend|month)|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|(?:in |on |of )may|may (?=\d)|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,4}[-/]\d{1,2}(?:[-/]\d{1,4})?|(?:on the )\d{1,2}(?:st|nd|rd|th))\b/i;

// Interpret explicit timetable end years and ISO dates conservatively. A year
// without a day covers that year. Leave the full schedule intact for generation.
function timetableEnded(passage: string, query: string) {
  const end = /\b(?:valid (?:only )?(?:until|through|in)|ended (?:on|in))\s+(?:[a-z]+\s+)?(\d{4})(-\d{2}-\d{2})?\b/i.exec(passage);
  if (!end) return false;
  const travelDay = /\b\d{4}-\d{2}-\d{2}\b/.exec(query)?.[0] ?? new Date().toISOString().slice(0, 10);
  return end[1]! + (end[2] ?? "-12-31") < travelDay;
}

// This guard covers explicit English point-to-point passenger questions.
export function routeClarification(query: string, excerpts: string[], priorUserQuestions: string[] = []) {
  const mode = /\b(bus|train|flight|rail)\b/i.exec(query)?.[1]?.toLowerCase();
  if (!mode) return null;
  const route = /\bfrom\s+([\p{L}][\p{L} .’-]{0,60}?)\s+to\s+([\p{L}][\p{L} .’-]{0,60}?)(?=\s+(?:by|in|on|for|using|via|tomorrow|today|next|this)\b|[?!.,]|$)/iu.exec(query);
  if (!route) return null;
  const escape = (place: string) => place.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direction = new RegExp(`\\b${escape(route[1]!)}\\s+(?:to|→|–|-)\\s+${escape(route[2]!)}\\b`, "i");
  const transport = mode === "bus" ? /\b(bus|buses|coach)\b/i : mode === "flight" ? /\b(flights?|flies|airline)\b/i : /\b(train|rail|railway)\b/i;
  const hasService = excerpts.flatMap(evidencePassages).some(paragraph => {
    const sentences = paragraph.split(/(?<=[.!?])\s+|\n+/).map(text => text.trim()).filter(Boolean);
    return sentences.some((sentence, index) => {
      if (!direction.test(sentence) || !transport.test(sentence) ||
          !/\b(runs?|operates?|serves?|departs?|leaves?|scheduled|bookable)\b/i.test(sentence) ||
          /\b(no|not|never|unconfirmed|proposed|planned|formerly|may|could|whether)\b/i.test(sentence)) return false;
      let passage = sentence;
      for (const next of sentences.slice(index + 1)) {
        // A separately named route starts its own account of service.
        if (/\bfrom .+? to \S/i.test(next) && !direction.test(next)) break;
        passage += " " + next;
      }
      return !inactive.test(passage) && !timetableEnded(passage, query);
    });
  });
  if (hasService) return null;

  const limitation = "The retrieved excerpts do not confirm service for this trip.";
  const destination = route[2]!.trim();
  const regionalDestination = new RegExp(`\\b(?:town in ${escape(destination)}|${escape(destination)} (?:state|province|region|county|(?:and|&) other states))\\b`, "i");
  const needsTown = /\b(state|region|province|county)\b/i.test(destination) ||
    excerpts.some(text => regionalDestination.test(text));
  // A previously supplied date is enough to avoid asking for it again. Never
  // assign a date from another question to this itinerary.
  const needsDate = ![query, ...priorUserQuestions].some(text => travelDate.test(text));
  if (needsTown && needsDate) return limitation + " Which arrival town or terminal and travel date should I check?";
  if (needsTown) return limitation + " Which arrival town or terminal should I check?";
  if (needsDate) return limitation + " What date should I check in the operator’s timetable for these stops?";
  return limitation + " Check the operator’s current timetable for both stops on your travel date.";
}
