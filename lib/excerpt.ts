// A condition in the following sentence can reverse the meaning of the
// preceding one. Keep those sentences together when splitting long passages.
function continuesPassage(text: string) {
  return /^(?:however|but|except|unless|only|subject to|provided that|this (?:does not|applies only)|(?:this|that|the) (?:service|route|timetable|schedule)|(?:service|it) (?:was|is|has|had|will|does|only)|(?:advance )?(?:reservations?|booking) (?:is|are)|valid (?:only|from|until|through)|as of|effective)\b/i.test(text.trim());
}

export function evidencePassages(text: string): string[] {
  const passages: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const sentences = paragraph.length > 1000
      ? paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/)
      : [paragraph];
    for (const sentence of sentences) {
      const part = sentence.trim();
      if (!part) continue;
      if (passages.length && continuesPassage(part))
        passages[passages.length - 1] += " " + part;
      else passages.push(part);
    }
  }
  return passages;
}

export function wholeExcerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  let excerpt = "";
  for (const passage of evidencePassages(text)) {
    const next = excerpt ? excerpt + "\n\n" + passage : passage;
    if (next.length > limit) break;
    excerpt = next;
  }
  return excerpt;
}
