import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const localTokens = new URL('../design/design-tokens.css', import.meta.url);
test('application matches the local approved design tokens', { skip: !existsSync(localTokens) && 'Local design sources are not included in the repository' }, () => {
  assert.equal(readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8'), readFileSync(localTokens, 'utf8'));
});

test('application uses semantic typography', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const file of ['app.css', 'article.css']) {
    const css = read(`../src/styles/${file}`);
    for (const match of css.matchAll(/(?<![-\w])(font-size|line-height|font-weight)\s*:\s*([^;}]+)/g)) assert.match(match[2], /^(var\(|calc\(|inherit)/, `${file}: ${match[0]}`);
  }
});
