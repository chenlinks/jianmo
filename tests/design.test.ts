import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('application uses the exact approved design tokens and semantic typography', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../src/styles/tokens.css'), read('../design/design-tokens.css'));
  for (const file of ['app.css', 'article.css']) {
    const css = read(`../src/styles/${file}`);
    for (const match of css.matchAll(/(?<![-\w])(font-size|line-height|font-weight)\s*:\s*([^;}]+)/g)) assert.match(match[2], /^(var\(|calc\(|inherit)/, `${file}: ${match[0]}`);
  }
});
