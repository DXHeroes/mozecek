// Agent Skills resolves file references from the skill root, one level deep, so a skill cannot
// reach a shared directory above itself. Each skill therefore carries its own copy of the
// references it loads. `references/` at the plugin root stays the single source of truth — the
// Claude Code subagent reads it, and these tests keep every copy byte-identical to it, because a
// skill quietly loading older security rules than its neighbour is the failure worth preventing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('.', import.meta.url));
const PLUGIN = dirname(SKILLS);
const CANONICAL = join(PLUGIN, 'references');

const skillDirs = readdirSync(SKILLS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => {
    try {
      return statSync(join(SKILLS, name, 'SKILL.md')).isFile();
    } catch {
      return false;
    }
  })
  .sort();

test('the skills are discovered where the specification looks for them', () => {
  assert.deepEqual(skillDirs, ['recall', 'remember', 'review', 'sleep']);
});

test('every reference a skill loads is bundled with that skill and matches the source', () => {
  for (const skill of skillDirs) {
    const body = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const referenced = [...body.matchAll(/(?:^|\s)references\/([a-z0-9.-]+\.md)/gm)].map((m) => m[1]);
    assert.ok(referenced.length > 0, `${skill}: loads no references`);

    for (const name of new Set(referenced)) {
      const bundled = join(SKILLS, skill, 'references', name);
      let copy;
      try {
        copy = readFileSync(bundled, 'utf8');
      } catch {
        assert.fail(`${skill}: references ${name} but does not bundle it at references/${name}`);
      }
      assert.equal(
        copy,
        readFileSync(join(CANONICAL, name), 'utf8'),
        `${skill}/references/${name} has drifted from references/${name}`,
      );
    }
  }
});

test('no skill reaches outside its own directory for a reference', () => {
  for (const skill of skillDirs) {
    const body = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(body, /\.\.\//, `${skill}: a path leaving the skill root is not portable`);
    // `@file` is a Claude Code directive; other clients read a plain relative path.
    assert.doesNotMatch(body, /@file/, `${skill}: @file is not portable`);
  }
});

test('nothing is bundled that the skill never loads', () => {
  for (const skill of skillDirs) {
    const dir = join(SKILLS, skill, 'references');
    let bundled;
    try {
      bundled = readdirSync(dir);
    } catch {
      continue;
    }
    const body = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
    for (const name of bundled) {
      assert.ok(body.includes(`references/${name}`), `${skill}: bundles unused references/${name}`);
    }
  }
});

test('frontmatter carries the two fields every client needs, and name matches the directory', () => {
  for (const skill of skillDirs) {
    const body = readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const match = body.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(match, `${skill}: no frontmatter`);
    const front = match[1];

    const name = front.match(/^name:\s*"?([^"\n]+)"?/m)?.[1]?.trim();
    assert.equal(name, skill, `${skill}: name must match the directory it lives in`);
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${skill}: name is not a valid skill name`);

    const description = front.match(/^description:\s*"?([\s\S]*?)"?\s*$/m)?.[1];
    assert.ok(description && description.length > 0, `${skill}: description is required`);
    assert.ok(description.length <= 1024, `${skill}: description exceeds 1024 characters`);
  }
});
