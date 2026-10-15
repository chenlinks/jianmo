import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, newDocument, edited, saved, isDirty, serializeWorkspace, parseWorkspace, loadWorkspace, STORAGE_KEY, migratePrototype, normalizeName, wordCount } from '../src/core/documents.ts';
import { formatSelection } from '../src/core/format.ts';

test('saving an earlier snapshot never clears edits made while save was pending', () => {
  const original = newDocument('draft', 'first');
  const typing = edited(original, 'second');
  const result = saved(typing, original.content, { handle: '1', name: 'saved.md', path: '/saved.md' });
  assert.equal(result.content, 'second'); assert.equal(result.savedContent, 'first'); assert.ok(isDirty(result));
  assert.equal(result.name, 'saved.md'); assert.equal(result.nativeHandle, '1');
});
test('successful save clears the exact snapshot only', () => {
  const doc = newDocument('test.md', '文稿'); assert.equal(isDirty(saved(doc, '文稿', {})), false);
});
test('drafts round-trip without persisting native session permissions', () => {
  const state = initialWorkspace(); state.documents[0].nativeHandle = 'session'; state.documents[0].path = 'C:/secret.md';
  const serialized = serializeWorkspace(state); assert.ok(!serialized.includes('secret.md')); assert.ok(!serialized.includes('session'));
  const result = parseWorkspace(serialized); assert.equal(result.documents[0].content, state.documents[0].content);
  assert.equal(result.activeId, state.activeId); assert.equal(result.documents[0].nativeHandle, undefined);
});
test('corrupt storage does not get replaced by a fresh demo workspace', () => {
  const original = '{broken'; let writes = 0;
  const storage = { getItem: () => original, setItem: () => { writes++; } };
  const loaded = loadWorkspace(storage); assert.equal(loaded.writable, false); assert.ok(loaded.error); assert.equal(writes, 0);
});
test('denied storage is reported instead of claiming saved', () => {
  const loaded = loadWorkspace({ getItem() { throw new Error('denied'); }, setItem() {} });
  assert.equal(loaded.writable, false); assert.ok(loaded.error);
});
test('valid existing workspace wins over legacy storage', () => {
  const state = initialWorkspace(); state.documents[0].content = 'personal text';
  const result = loadWorkspace({ getItem: key => key === STORAGE_KEY ? serializeWorkspace(state) : 'bad legacy', setItem() {} });
  assert.equal(result.state.documents[0].content, 'personal text'); assert.equal(result.error, null);
});
test('migrates the actual prototype body field, not just sample content', () => {
  const result = migratePrototype(JSON.stringify({ docs: [{ id: 'one', name: '我的文章.md', body: '旧版内容', starred: true }], activeId: 'one', theme: 'warm', fontSize: 20 }));
  assert.equal(result.documents[0].content, '旧版内容'); assert.equal(result.theme, 'warm'); assert.equal(result.fontSize, 20);
});
test('invalid identities are rejected and missing active document is recovered', () => {
  const state = initialWorkspace(); state.activeId = 'missing';
  assert.equal(parseWorkspace(serializeWorkspace(state)).activeId, state.documents[0].id);
  state.documents.push(state.documents[0]); assert.throws(() => parseWorkspace(serializeWorkspace(state)));
});
test('normalizes filenames without accepting path fragments', () => {
  assert.equal(normalizeName('文稿'), '文稿.md'); assert.equal(normalizeName(' hello.txt '), 'hello.txt');
  assert.ok(!normalizeName('../bad:name').includes('/')); assert.equal(normalizeName('...'), '未命名.md');
});
test('formatting replaces selected text once and preserves surrounding text', () => {
  const result = formatSelection('a link z', 2, 6, 'link'); assert.equal(result.text, 'a [link](https://example.com) z');
  assert.equal(result.text.slice(result.start, result.end), 'link');
  assert.equal(formatSelection('one\ntwo', 0, 7, 'task').text, '- [ ] one\n- [ ] two');
  assert.equal(formatSelection('\ntext', 0, 0, 'heading').text, '## 内容\ntext');
});
test('word count handles Chinese and Latin words', () => { assert.equal(wordCount('今天 hello world'), 4); });
