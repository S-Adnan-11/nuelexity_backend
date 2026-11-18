// A condition in the following sentence can reverse the meaning of the
// preceding one. Keep those sentences together when splitting long passages.
export function evidencePassages(text: string): string[] {
  const passages: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const sentences = paragraph.length > 1000
      ? paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/)
      : [paragraph];
    for (const sentence of sentences) {
      if (!sentence) continue;
      if (passages.length && /^(?:however|but|except|unless|only|subject to|provided that|this (?:does not|applies only)|service (?:is suspended|does not))\b/i.test(sentence))
        passages[passages.length - 1] += " " + sentence;
      else passages.push(sentence);
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
