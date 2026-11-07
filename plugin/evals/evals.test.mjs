// The eval suite in this directory runs `/mozecek:remember` for real (`claude plugin eval ./plugin`,
// see README.md) against canned `mozecek_*` answers and grades the calls the skill sends to the
// stand-in server. A run costs money and needs a logged-in Claude Code, so nobody runs it on every
// change. These tests are the cheap half: they keep the suite runnable and keep it asking the
// question it exists for, so a renamed server key, a widened mock or a deleted case is caught here
// and not by a paid run that silently grades nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVALS = fileURLToPath(new URL('.', import.meta.url));
const PLUGIN = dirname(EVALS);
const REPO = dirname(PLUGIN);
const MOCKS = join(EVALS, 'mocks');
const SERVER = join(MOCKS, 'mozecek');

// What the server accepts for `visibility`; `agent` is its default.
const VISIBILITIES = ['agent', 'workspace'];
// The tools the remember flow reaches when memory holds nothing similar.
const FLOW = ['mozecek_search', 'mozecek_remember'];

const cases = readdirSync(EVALS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !['mocks', 'results'].includes(entry.name))
  .map((entry) => ({ name: entry.name, yaml: readFileSync(join(EVALS, entry.name, 'case.yaml'), 'utf8') }));

function field(yaml, key) {
  return yaml.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]*?)"?\\s*$`, 'm'))?.[1];
}

function prompt(yaml) {
  const match = yaml.match(/^\s*prompt:\s*\|\n((?:\s{4,}.*\n?)+)/m);
  assert.ok(match, 'execution.prompt must be a literal block');
  return match[1].trim();
}

// The graders that read the calls the stand-in server received, as { name, pattern, match }.
function mockCallGraders(yaml) {
  return yaml
    .split(/\n\s*- type: /)
    .filter((grader) => /^\s*target:\s*mock_calls\s*$/m.test(grader))
    .map((grader) => ({
      name: field(grader, 'name'),
      pattern: grader.match(/^\s*pattern:\s*'([^']*)'\s*$/m)?.[1],
      flags: grader.match(/^\s*flags:\s*"?([a-z]*)"?\s*$/m)?.[1] ?? '',
      match: field(grader, 'match') ?? 'contains',
    }));
}

// One line of the `mock_calls` text the harness grades: the call as JSON, one call per line.
function callLine(tool, input) {
  return JSON.stringify({ tool: `mcp__plugin_mozecek_mozecek__${tool}`, input, output: '{}', verdict: 'ok' });
}

function grade({ pattern, flags, match }, calls) {
  const text = calls.join('\n');
  const hits = [...text.matchAll(new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`))].length;
  if (match === 'contains') return hits > 0;
  if (match === 'not_contains') return hits === 0;
  return hits === Number(match.replace('count:', ''));
}

function passes(graders, calls) {
  return graders.every((grader) => grade(grader, calls));
}

function body(file) {
  return readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
}

test('every case is named after its folder and lets the run finish', () => {
  assert.ok(cases.length > 0, 'the suite has no case');
  for (const { name, yaml } of cases) {
    assert.equal(field(yaml, 'name'), name, `${name}: name differs from the folder`);
    assert.equal(field(yaml, 'schema_version'), '1.1', `${name}: schema_version`);
    // The harness caps a run at 10 turns without the key; 200 is its maximum and means no cap.
    assert.equal(field(yaml, 'max_turns'), '200', `${name}: max_turns`);
  }
});

test('the mocks stand in for the server the plugin declares, under its key', () => {
  for (const manifest of ['.mcp.json', 'mcp.json']) {
    const servers = Object.keys(JSON.parse(readFileSync(join(PLUGIN, manifest), 'utf8')).mcpServers);
    const mocked = readdirSync(MOCKS).filter((entry) => statSync(join(MOCKS, entry)).isDirectory());
    assert.ok(mocked.length > 0, 'no mocked server');
    for (const server of mocked) assert.ok(servers.includes(server), `mocks/${server} is not a server in ${manifest}`);
  }
});

test('the stand-in answers exactly the tools of the remember flow', () => {
  const tools = readdirSync(SERVER)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/, ''));
  assert.deepEqual(tools.sort(), [...FLOW].sort());
  const listed = JSON.parse(readFileSync(join(SERVER, '_tools.json'), 'utf8')).tools.map((tool) => tool.name);
  assert.deepEqual(listed.sort(), [...FLOW].sort(), '_tools.json lists the mocked tools and nothing else');
});

test('the listed schemas carry the server\'s visibility and include_workspace', () => {
  const tools = Object.fromEntries(
    JSON.parse(readFileSync(join(SERVER, '_tools.json'), 'utf8')).tools.map((tool) => [tool.name, tool.inputSchema]),
  );
  const visibility = tools.mozecek_remember.properties.visibility;
  assert.deepEqual(visibility.enum, VISIBILITIES);
  assert.equal(visibility.default, 'agent');
  assert.equal(tools.mozecek_remember.additionalProperties, false, 'the server schema is strict');
  assert.equal(tools.mozecek_search.properties.include_workspace.default, true);
});

// With nothing similar in memory the skill has to write a new row, so the run reaches
// `mozecek_remember` and the written visibility is what gets graded.
test('the search stand-in finds nothing and the remember stand-in echoes the written visibility', () => {
  const search = JSON.parse(body(join(SERVER, 'mozecek_search.md')));
  assert.deepEqual(search.results, []);
  const remember = body(join(SERVER, 'mozecek_remember.md'));
  assert.match(remember, /"visibility": "\{\{input\.visibility\}\}"/);
});

// DXHeroes/dxhagents#192: `--visibility workspace` writes a shared row, and no flag writes an
// `agent` row. Both cases run the same text, so the flag is the only thing that differs.
test('the suite runs remember with and without --visibility workspace on the same text', () => {
  const remember = cases.filter(({ yaml }) => prompt(yaml).startsWith('/mozecek:remember '));
  const shared = remember.filter(({ yaml }) => / --visibility workspace\b/.test(prompt(yaml)));
  const own = remember.filter(({ yaml }) => !/--visibility/.test(prompt(yaml)));
  assert.equal(shared.length, 1, 'one case passes --visibility workspace');
  assert.equal(own.length, 1, 'one case passes no --visibility');
  assert.equal(prompt(shared[0].yaml).replace(/ --visibility workspace\b/, ''), prompt(own[0].yaml));
});

// The graders are regexes over JSON lines, so they are checked here against the calls they must
// tell apart: a grader that passes every run, or fails every run, proves nothing.
test('the workspace case passes a shared write and fails an own one', () => {
  const graders = mockCallGraders(cases.find(({ yaml }) => /--visibility workspace/.test(prompt(yaml))).yaml);
  assert.ok(graders.length >= 2, 'the workspace case grades the mock calls');
  const search = (workspace) => callLine('mozecek_search', { query: 'x', k: 5, include_workspace: workspace });
  const write = (extra) =>
    callLine('mozecek_remember', { content: 'x', kind: 'procedural', source: { type: 'mcp' }, ...extra });
  assert.ok(passes(graders, [search(true), write({ visibility: 'workspace' })]));
  assert.ok(!passes(graders, [search(true), write({ visibility: 'agent' })]), 'an agent row must fail');
  assert.ok(!passes(graders, [search(true), write({})]), 'a write without visibility is an agent row');
  assert.ok(!passes(graders, [search(false), write({ visibility: 'workspace' })]), 'the search must see shared rows');
  assert.ok(!passes(graders, [search(true)]), 'a run that writes nothing must fail');
  const twice = [search(true), write({ visibility: 'workspace' }), write({ visibility: 'workspace' })];
  assert.ok(!passes(graders, twice), 'one claim, one row');
});

test('the default case passes an own write and fails a shared one', () => {
  const graders = mockCallGraders(cases.find(({ yaml }) => !/--visibility/.test(prompt(yaml))).yaml);
  assert.ok(graders.length >= 2, 'the default case grades the mock calls');
  const search = (workspace) => callLine('mozecek_search', { query: 'x', k: 5, include_workspace: workspace });
  const write = (extra) => callLine('mozecek_remember', { content: 'x', source: { type: 'mcp' }, ...extra });
  assert.ok(passes(graders, [search(false), write({ visibility: 'agent' })]));
  assert.ok(passes(graders, [search(false), write({})]), 'the server default is agent');
  assert.ok(!passes(graders, [search(false), write({ visibility: 'workspace' })]), 'a shared row must fail');
  assert.ok(!passes(graders, [search(true), write({ visibility: 'agent' })]), 'the search stays with own rows');
  assert.ok(!passes(graders, [search(false)]), 'a run that writes nothing must fail');
});

test('run output stays out of git', () => {
  const ignored = readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n');
  assert.ok(ignored.includes('plugin/evals/results/'), 'plugin/evals/results/ is ignored');
  assert.ok(ignored.includes('plugin/evals/mocks/recordings/'), 'plugin/evals/mocks/recordings/ is ignored');
});
