// `/mozecek:remember` is a prompt, so these tests pin the parts of it a caller depends on: the
// `--visibility` switch and how it reaches the tools, and examples the server would actually accept.
// The server's `mozecek_remember` schema is strict: an unknown visibility, a string `source` or a
// date without a time is rejected, and an agent that copies such an example fails its write.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('.', import.meta.url));
const PLUGIN = dirname(SKILLS);
const REFERENCES = join(PLUGIN, 'references');
const SKILL = readFileSync(join(SKILLS, 'remember', 'SKILL.md'), 'utf8');

// What the server accepts for `visibility`; `agent` is its default.
const VISIBILITIES = ['agent', 'workspace'];

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.ok(start >= 0, `missing section ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

function block(markdown, tag) {
  const match = markdown.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  assert.ok(match, `missing <${tag}>`);
  return match[1];
}

test('remember offers --visibility agent|workspace in its hint and its help', () => {
  const front = SKILL.match(/^---\n([\s\S]*?)\n---/)[1];
  const hint = front.match(/^argument-hint:\s*"([^"]*)"/m)?.[1] ?? '';
  assert.match(hint, /\[--visibility agent\|workspace\]/);
  assert.match(block(SKILL, 'no-args-guard'), /--visibility agent\|workspace/);
});

test('remember states that visibility defaults to agent', () => {
  assert.match(block(SKILL, 'input'), /--visibility[^.]*default `agent`/);
});

test('remember passes the visibility to mozecek_remember', () => {
  const workflow = block(SKILL, 'workflow');
  const call = workflow.split(/\n(?=\d+\. )/).find((step) => /^\d+\. Call `mozecek_remember`/.test(step));
  assert.ok(call, 'no workflow step calls mozecek_remember');
  assert.match(call, /`visibility`/);
});

test('remember searches the shared memories for duplicates only when writing to the workspace', () => {
  const workflow = block(SKILL, 'workflow');
  const search = workflow.split(/\n(?=\d+\. )/).find((step) => /^\d+\. `mozecek_search`/.test(step));
  assert.ok(search, 'no workflow step runs mozecek_search');
  assert.match(search, /`include_workspace: true`[^.]*`workspace`|`workspace`[^.]*`include_workspace: true`/);
  assert.match(search, /`include_workspace: false`/);
});

test('every visibility in the references and skills is one the server accepts', () => {
  const files = [
    ...readdirSync(REFERENCES).map((name) => join(REFERENCES, name)),
    ...readdirSync(SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(SKILLS, entry.name, 'SKILL.md')),
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, value] of text.matchAll(/"visibility":\s*"([^"]*)"/g)) {
      assert.ok(VISIBILITIES.includes(value), `${file}: visibility "${value}" is not ${VISIBILITIES.join(' | ')}`);
    }
  }
});

test('the memory model names the visibilities the server accepts', () => {
  const model = section(readFileSync(join(REFERENCES, 'memory-model.md'), 'utf8'), '## Visibility');
  for (const value of VISIBILITIES) assert.match(model, new RegExp(`\`${value}\``));
  assert.doesNotMatch(model, /`private`/);
  assert.match(model, /default is `agent`/);
});

test('the remember examples in the cheatsheet would pass the server schema', () => {
  const remember = section(readFileSync(join(REFERENCES, 'tool-cheatsheet.md'), 'utf8'), '## `remember`');
  const examples = [...remember.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.ok(examples.length > 0, 'the remember section has no JSON example');
  const isoDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  for (const example of examples) {
    assert.equal(typeof example.content, 'string');
    if ('visibility' in example) assert.ok(VISIBILITIES.includes(example.visibility));
    if ('observed_at' in example) assert.match(example.observed_at, isoDatetime);
    if ('source' in example) {
      assert.equal(typeof example.source, 'object', '`source` is an object with a `type`');
      assert.ok(example.source && typeof example.source.type === 'string');
    }
  }
  assert.ok(examples.some((example) => example.visibility === 'workspace'), 'show a shared write');
});
