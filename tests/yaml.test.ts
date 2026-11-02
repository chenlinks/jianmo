import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatYaml } from '../src/core/yaml.ts';
import { mediaMarkdown } from '../src/core/media.ts';

test('YAML formatter normalizes nested indentation and is idempotent', async () => {
  const formatted = await formatYaml('app:\r\n    name: 笺墨\r\n    ports:\r\n        - 1420\r\n        - 4173');
  assert.equal(formatted, 'app:\n  name: 笺墨\n  ports:\n    - 1420\n    - 4173\n');
  assert.equal(await formatYaml(formatted), formatted);
  assert.match(mediaMarkdown({ kind: 'codeblock', language: 'yml', value: formatted }), /```yml\napp:\n  name: 笺墨/);
});

test('YAML formatter preserves comments, anchors, tags, multiline strings and documents', async () => {
  const source = '# 配置\n---\ndefaults: &defaults\n    enabled: true # 保留\ncopy: *defaults\nsecret: !env TOKEN\ntext: |\n    hello\n    world\n---\nname: "001"\n';
  const formatted = await formatYaml(source);
  for (const value of ['# 配置', '&defaults', '# 保留', '*defaults', '!env TOKEN', 'text: |\n  hello\n  world', 'name: "001"']) assert.ok(formatted.includes(value), value);
  assert.equal(formatted.match(/^---$/gm)?.length, 2);
  assert.equal(await formatYaml(formatted), formatted);
});

test('YAML formatter handles empty input and reports invalid syntax with its location', async () => {
  assert.equal(await formatYaml(''), '');
  assert.equal(await formatYaml('  \n'), '');
  await assert.rejects(formatYaml('items: [one, two'), /\(1:\d+\)/);
});
