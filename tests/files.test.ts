import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserFile, saveNativeFile, openNativeFile } from '../src/platform/files.ts';
test('browser import validates extension and UTF-8 without an application size cap', async () => {
  await assert.rejects(readBrowserFile(new File(['test'], 'test.exe')), /请选择/);
  const large = '中文'.repeat(500000);
  assert.equal((await readBrowserFile(new File([large], 'big.md'))).content, large);
  await assert.rejects(readBrowserFile(new File([new Uint8Array([255])], 'bad.md')));
  const result = await readBrowserFile(new File(['# 你好'], 'ok.md')); assert.equal(result.content, '# 你好');
});
test('native bridge preserves cancellation and sends handles rather than arbitrary paths', async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  Object.defineProperty(globalThis, 'window', { value: { __TAURI__: { core: { invoke: async (command: string, args?: Record<string, unknown>) => { calls.push({ command, args }); return null; } } } }, configurable: true });
  assert.equal(await openNativeFile(), null); assert.equal(await saveNativeFile('draft', 'name', 'token'), null);
  assert.deepEqual(calls[1], { command: 'save_document', args: { content: 'draft', name: 'name.md', handle: 'token' } });
});
