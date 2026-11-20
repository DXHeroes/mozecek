// node --test plugin/bin/catalog.test.mjs
//
// Checks the shipped single-file catalog tool, plugin/bin/mozecek-catalog.mjs, end to end:
// it builds a catalog over a small git repository without a model, and check accepts it,
// then rejects it once a cataloged file changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG = join(dirname(fileURLToPath(import.meta.url)), 'mozecek-catalog.mjs');

// A 1×1 PNG: signature, IHDR, IDAT and IEND chunks.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Runs the catalog tool without a model key, so nothing can leave the machine. */
const run = (args, cwd) => {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  return spawnSync(process.execPath, [CATALOG, ...args], { cwd, env, encoding: 'utf8' });
};

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

/** A git repository with a short and a long markdown, a csv and a png in a subfolder. */
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mozecek-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nA short note.\n');
  const long = Array.from({ length: 220 }, (_, i) => `Line ${i + 1} of a long note.`);
  writeFileSync(join(root, 'docs', 'long.md'), `# Long\n\n${long.join('\n')}\n`);
  writeFileSync(join(root, 'docs', 'data.csv'), 'name,count\nalpha,1\nbeta,2\n');
  writeFileSync(join(root, 'docs', 'pixel.png'), PNG);
  git(['init', '-q'], root);
  git(['add', '-A'], root);
  return root;
};

const output = (r) => `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

test('the tool is shipped next to this test', () => {
  assert.ok(existsSync(CATALOG), `missing ${CATALOG}`);
});

test('--version prints the tool name', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /^mozecek-catalog/);
});

test('build --no-model catalogs every folder and check accepts it', (t) => {
  const root = fixture(t);

  const build = run(['build', '.', '--no-model'], root);
  assert.equal(build.status, 0, output(build));
  assert.ok(existsSync(join(root, '_context.json')), 'root _context.json');
  assert.ok(existsSync(join(root, 'docs', '_context.json')), 'docs/_context.json');
  assert.ok(existsSync(join(root, 'docs', 'pixel.png.meta.json')), 'sidecar of the png');
  assert.ok(existsSync(join(root, 'docs', 'long.md.meta.json')), 'sidecar of the long markdown');

  const check = run(['check', '.'], root);
  assert.equal(check.status, 0, output(check));
});

test('check fails once a cataloged file changes', (t) => {
  const root = fixture(t);
  const build = run(['build', '.', '--no-model'], root);
  assert.equal(build.status, 0, output(build));

  appendFileSync(join(root, 'README.md'), 'Edited after the build.\n');

  const check = run(['check', '.'], root);
  assert.equal(check.status, 1, output(check));
});
