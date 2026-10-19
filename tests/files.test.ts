import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserFile, saveNativeFile, openNativeFile, watchNativeFiles } from '../src/platform/files.ts';
import type { NativeOpenResult } from '../src/platform/files.ts';
test('browser import validates extension and UTF-8 without an application size cap', async () => {
  await assert.rejects(readBrowserFile(new File(['test'], 'test.exe')), /请选择/);
  const large = '中文'.repeat(500000);
  assert.equal((await readBrowserFile(new File([large], 'big.md'))).content, large);
  await assert.rejects(readBrowserFile(new File([new Uint8Array([255])], 'bad.md')));
  const result = await readBrowserFile(new File(['# 你好'], 'ok.md')); assert.equal(result.content, '# 你好');
});

test('external file opens subscribe before draining and serialize later requests', async () => {
  const order: string[] = []; let notify: (() => void) | undefined;
  const responses: ((results: NativeOpenResult[]) => void)[] = [];
  let unlistened = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI__: {
    event: { listen: async (event: string, callback: () => void) => { order.push(event); notify = callback; return () => { unlistened = true; }; } },
    core: { invoke: (command: string) => { order.push(command); return new Promise<NativeOpenResult[]>(resolve => responses.push(resolve)); } }
  } } });
  const received: NativeOpenResult[][] = []; const errors: unknown[] = [];
  const stop = watchNativeFiles(results => received.push(results), error => errors.push(error));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['documents-pending', 'take_pending_documents']);
  notify!(); notify!();
  assert.equal(responses.length, 1, 'in-flight drains cannot run concurrently');
  const first: NativeOpenResult[] = [{ status: 'opened', value: { handle: '1', path: 'C:/中文 文件.md', name: '中文 文件.md', content: '# 中文' } }];
  responses[0](first);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses.length, 2, 'a launch during a drain triggers another drain');
  responses[1]([{ status: 'error', value: 'missing.md：文件不存在' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(received.length, 2); assert.deepEqual(received[0], first); assert.deepEqual(errors, []);
  stop(); assert.ok(unlistened);
  notify!(); assert.equal(responses.length, 2);
});

test('external file watcher cancels pending subscription without consuming launch files', async () => {
  let subscribe: ((stop: () => void) => void) | undefined; let unlistened = false; let drained = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI__: {
    event: { listen: () => new Promise<() => void>(resolve => { subscribe = resolve; }) },
    core: { invoke: async () => { drained = true; return []; } }
  } } });
  const stop = watchNativeFiles(() => {}, assert.fail);
  stop(); subscribe!(() => { unlistened = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(unlistened); assert.equal(drained, false);
});
test('native bridge preserves cancellation and sends handles rather than arbitrary paths', async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  Object.defineProperty(globalThis, 'window', { value: { __TAURI__: { core: { invoke: async (command: string, args?: Record<string, unknown>) => { calls.push({ command, args }); return null; } } } }, configurable: true });
  assert.equal(await openNativeFile(), null); assert.equal(await saveNativeFile('draft', 'name', 'token'), null);
  assert.deepEqual(calls[1], { command: 'save_document', args: { content: 'draft', name: 'name.md', handle: 'token' } });
});
