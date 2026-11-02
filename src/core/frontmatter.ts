/** Front matter is recognized only before the Markdown body, never inside it. */
export function splitFrontmatter(source: string): { raw: string; yaml: string; body: string } | undefined {
  const opening = /^\uFEFF?(?:[ \t]*\r?\n)*---[ \t]*\r?\n/.exec(source);
  if (!opening) return;
  const rest = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return;
  const end = opening[0].length + closing.index + closing[0].length;
  return { raw: source.slice(0, end), yaml: rest.slice(0, closing.index), body: source.slice(end) };
}
