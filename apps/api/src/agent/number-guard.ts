const numberPattern = /\d+(?:,\d+)*(?:\.\d+)?/g;
const listMarkerPattern = /^\s*\d{1,2}[.)]\s/gm;

function normalise(token: string): string {
  const plain = token.replace(/,/g, '');
  if (!plain.includes('.')) return plain.replace(/^0+(?=\d)/, '');
  return plain
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace(/^0+(?=\d)/, '');
}

/** Every number in the text, normalised, in order and with repeats. */
export function numberTokens(text: string): string[] {
  return [...text.replace(listMarkerPattern, '').matchAll(numberPattern)].map((match) =>
    normalise(match[0]),
  );
}

export function extractNumbers(text: string): Set<string> {
  return new Set(numberTokens(text));
}

/**
 * Numbers in a reply that do not appear in any trusted source (tool results, the user's own
 * messages, the system prompt). A non-empty result means the model produced a figure itself.
 */
export function findUnsupportedNumbers(reply: string, sources: string[]): string[] {
  const allowed = new Set(sources.flatMap((source) => [...extractNumbers(source)]));
  return [...extractNumbers(reply)].filter((value) => !allowed.has(value));
}
