import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { changeListLevel, listKey } from '../src/core/lists.ts';

test('ordered and unordered nesting preserves children and sibling reading order', () => {
  for (const tag of ['ul', 'ol']) {
    const dom = new JSDOM(`<${tag}><li>A</li><li>B<${tag}><li>C</li></${tag}></li><li>D</li></${tag}>`);
    const document = dom.window.document; const list = document.body.firstElementChild!;
    const item = list.children[1] as HTMLLIElement;
    assert.equal(changeListLevel(list.children[0] as HTMLLIElement, false), null);
    changeListLevel(item, false); assert.equal(list.children.length, 2); assert.equal(item.parentElement!.parentElement, list.children[0]);
    changeListLevel(item, true); assert.deepEqual(Array.from(list.children).map(li => li.firstChild!.textContent), ['A', 'B', 'D']);
    assert.equal(item.querySelector('li')?.textContent, 'C');
    changeListLevel(item, true); assert.equal(document.querySelector('p')?.textContent, 'BC'); assert.equal(document.body.lastElementChild?.textContent, 'D');
    dom.window.close();
  }
});
test('outdenting middle child preserves the order of following nested items', () => {
  const dom = new JSDOM('<ul><li>A<ul><li>B</li><li>C</li><li>D</li></ul></li><li>E</li></ul>');
  const item = dom.window.document.querySelectorAll('li')[2]; changeListLevel(item, true);
  assert.equal(dom.window.document.body.textContent, 'ABCDE'); assert.equal(item.querySelector('li')?.textContent, 'D'); dom.window.close();
});
test('source list keys continue numbering, demote and promote, empty items exit one level', () => {
  assert.equal(listKey('9. hello', 8, 8, 'Enter')?.text, '9. hello\n10. ');
  assert.equal(listKey('- [x] done', 10, 10, 'Enter')?.text, '- [x] done\n- [ ] ');
  const nested = listKey('- first\n- second', 16, 16, 'Tab')!;
  assert.equal(nested.text, '- first\n    - second');
  assert.equal(listKey(nested.text, nested.start, nested.end, 'Tab', true)?.text, '- first\n- second');
  assert.equal(listKey('    2. ', 7, 7, 'Enter')?.text, '2. ');
  assert.equal(listKey('2. ', 3, 3, 'Enter')?.text, '');
  assert.equal(listKey('- a\n- b', 0, 7, 'Tab')?.text, '    - a\n    - b');
  assert.equal(listKey('plain', 5, 5, 'Enter'), undefined);
});
