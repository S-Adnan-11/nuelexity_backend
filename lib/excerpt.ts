// Keep complete paragraphs when clipping. A trailing sentence can qualify or
// negate an earlier one. Omit a paragraph if its qualification will not fit.
export function wholeExcerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  const end = text.slice(0, limit + 2).lastIndexOf("\n\n");
  return end > 0 ? text.slice(0, end) : "";
}
