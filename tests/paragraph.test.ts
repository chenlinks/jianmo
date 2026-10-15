import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatParagraph, sourceHeadingLevel } from '../src/core/paragraph.ts';
test('paragraph formatting changes complete selected lines without touching adjacent lines', () => {
  const source = 'before\n## Heading\n- first\n- second\nafter';
  const start = source.indexOf('first'); const end = source.indexOf('after');
  assert.equal(formatParagraph(source, start, end, 'ordered').text, 'before\n## Heading\n1. first\n2. second\nafter');
  assert.equal(formatParagraph(source, 10, 10, 'h6').text, 'before\n###### Heading\n- first\n- second\nafter');
  assert.equal(sourceHeadingLevel('# first\n## second', 0), 1);
});
test('task status, nesting and code fences preserve literal content', () => {
  assert.equal(formatParagraph('- [ ] one\n- [x] two\nplain', 0, 19, 'checked').text, '- [x] one\n- [x] two\nplain');
  assert.equal(formatParagraph('    - child\nplain', 0, 18, 'outdent').text, '- child\nplain');
  assert.equal(formatParagraph('# title', 0, 0, 'headingUp').text, '# title');
  assert.equal(formatParagraph('###### title', 0, 0, 'headingDown').text, '###### title');
  assert.equal(formatParagraph('```js', 0, 5, 'codeblock').text, '````\n```js\n````');
});
