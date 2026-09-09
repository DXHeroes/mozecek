// node --test plugin/hooks/capture.test.mjs
//
// The fixture is a real-shaped Claude Code transcript: a user turn, an assistant turn with a
// tool_use part, the matching tool_result turn (which must never leave the machine) and a
// turn carrying secrets. The POST is asserted against a local http.createServer stub.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  agentFromToken,
  extractTurns,
  redactSecrets,
  resolveConfig,
  runCapture,
  tailFile,
} from './capture.mjs';

const LINES = [
  {
    type: 'user',
    timestamp: '2026-09-07T08:00:00Z',
    message: { role: 'user', content: 'What did we decide about pricing?' },
  },
  {
    type: 'assistant',
    timestamp: '2026-09-07T08:00:05Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look in memory.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'jq . brain/index/meetings.json' } },
      ],
    },
  },
  {
    type: 'user',
    timestamp: '2026-09-07T08:00:07Z',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', content: 'SUPER_TAJNY_VYSTUP_NASTROJE xoxb-1111-2222-abcdefghijkl' },
      ],
    },
  },
  { type: 'system', timestamp: '2026-09-07T08:00:08Z', content: 'ignore me' },
  {
    type: 'assistant',
    timestamp: '2026-09-07T08:00:09Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'The token is xoxb-9999-8888-zzzzzzzzzzzz and the key is sk-abcdefghijklmnopqrstuvwx.',
        },
      ],
    },
  },
];

let dir;
let transcript;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozecek-capture-'));
  transcript = path.join(dir, 'session.jsonl');
  fs.writeFileSync(transcript, `${LINES.map((l) => JSON.stringify(l)).join('\n')}\n`);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const baseEnv = (url) => ({
  MOZECEK_AUTO_CAPTURE: '1',
  MOZECEK_URL: url,
  MOZECEK_TOKEN: 'mz_demo_0123456789abcdef',
  MOZECEK_AGENT: 'demo',
});
const payload = () => ({
  session_id: 'sess-1',
  cwd: '/home/agent/repo',
  hook_event_name: 'Stop',
  transcript_path: transcript,
  stop_hook_active: false,
});

async function stubServer({ status = 202 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        type: req.headers['content-type'],
        body: JSON.parse(body),
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ capture_id: 'cap_1', status: 'queued' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('redactSecrets covers every shape the hook knows', () => {
  const text = [
    'xoxb-1111-2222-abcdefghijkl',
    'xoxr-3333-4444-abcdefghijkl',
    'xapp-1-A012-345-abcdefghijkl',
    'AKIAABCDEFGHIJKLMNOP',
    'sk-abcdefghijklmnopqrstuvwx',
    'ghp_abcdefghijklmnopqrstuvwxyz012345',
    'gho_abcdefghijklmnopqrstuvwxyz012345',
    'ghu_abcdefghijklmnopqrstuvwxyz012345',
    'ghs_abcdefghijklmnopqrstuvwxyz012345',
    'ghr_abcdefghijklmnopqrstuvwxyz012345',
    'github_pat_abcdefghijklmnopqrstuvwxyz',
    'GOCSPX-abcdefghijklmnop',
    'Authorization: Bearer abcdefghijklmnopqrst',
    'mz_demo_abcdefghijklmnopqrst',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const redacted = redactSecrets(text);
  for (const label of [
    'slack-token',
    'aws-key',
    'api-key',
    'github-token',
    'google-secret',
    'bearer',
    'mozecek-token',
    'private-key',
  ]) {
    assert.match(redacted, new RegExp(`\\[redacted:${label}\\]`), `missing ${label}`);
  }
  // Every prefix scripts/improvements/policy.mjs knows, not just the ones seen so far.
  assert.equal(
    /xox[baprs]-|xapp-|AKIA|gh[pousr]_|github_pat_|GOCSPX-|BEGIN RSA/.test(redacted),
    false,
  );
});

test('extractTurns drops tool results, keeps tool names and redacts', () => {
  const turns = extractTurns(fs.readFileSync(transcript, 'utf8'));
  assert.equal(turns.length, 3, 'the tool_result turn and the system line are gone');
  assert.deepEqual(
    turns.map((t) => t.role),
    ['user', 'assistant', 'assistant'],
  );
  assert.equal(turns[0].text, 'What did we decide about pricing?');
  assert.match(turns[1].text, /\[tool: Bash\]/);
  assert.equal(turns[0].ts, '2026-09-07T08:00:00Z');
  const all = turns.map((t) => t.text).join('\n');
  assert.equal(
    all.includes('SUPER_TAJNY_VYSTUP_NASTROJE'),
    false,
    'tool output must never be sent',
  );
  assert.equal(all.includes('xoxb-'), false);
  assert.match(all, /\[redacted:slack-token\]/);
  assert.match(all, /\[redacted:api-key\]/);
});

test('extractTurns trims the oldest turns over the limits', () => {
  const jsonl = Array.from({ length: 12 }, (_, i) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: `message ${i}` } }),
  ).join('\n');
  const byCount = extractTurns(jsonl, { maxTurns: 3 });
  assert.deepEqual(
    byCount.map((t) => t.text),
    ['message 9', 'message 10', 'message 11'],
  );
  const byChars = extractTurns(jsonl, { maxChars: 20 });
  assert.ok(byChars.reduce((sum, t) => sum + t.text.length, 0) <= 20);
  assert.equal(byChars.at(-1).text, 'message 11');
});

test('tailFile returns the tail and drops the partial first line', () => {
  const file = path.join(dir, 'tail.txt');
  fs.writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
  assert.equal(tailFile(file, 1024), 'aaaa\nbbbb\ncccc\n');
  assert.equal(tailFile(file, 8), 'cccc\n');
});

test('tailFile widens the window when one line is longer than it', () => {
  const file = path.join(dir, 'long-line.txt');
  // The last turn is 150 chars; a 100-byte window lands inside it and would yield nothing.
  fs.writeFileSync(file, `${'a'.repeat(50)}\n${'b'.repeat(150)}\n`);
  assert.equal(
    tailFile(file, 100),
    `${'b'.repeat(150)}\n`,
    'doubling up to 4x finds the line start',
  );

  // Beyond 4x it gives up rather than reading an unbounded transcript.
  const huge = path.join(dir, 'huge-line.txt');
  fs.writeFileSync(huge, `${'a'.repeat(50)}\n${'b'.repeat(5000)}\n`);
  assert.equal(tailFile(huge, 100), '');
});

test('a Stop hook posts the session to the capture endpoint', async () => {
  const stub = await stubServer();
  try {
    assert.equal(await runCapture(payload(), baseEnv(stub.url)), 'ok');
    assert.equal(stub.requests.length, 1);
    const request = stub.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/api/agents/demo/capture');
    assert.equal(request.auth, 'Bearer mz_demo_0123456789abcdef');
    assert.equal(request.type, 'application/json');
    assert.equal(request.body.session_id, 'sess-1');
    assert.equal(request.body.cwd, '/home/agent/repo');
    assert.equal(request.body.hook_event_name, 'Stop');
    assert.equal(request.body.turns.length, 3);
    // The capture endpoint validates a strict object and rejects nulls outright.
    for (const [key, value] of Object.entries(request.body)) {
      assert.notEqual(value, null, `${key} must never be sent as null`);
    }
    assert.match(request.body.captured_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(JSON.stringify(request.body).includes('SUPER_TAJNY_VYSTUP_NASTROJE'), false);

    // transcript_sha256 keeps the API's name but hashes the redacted payload that was sent,
    // not the transcript file: the file still holds the tool output and the raw tokens.
    const sha = (value) => createHash('sha256').update(value).digest('hex');
    assert.equal(
      request.body.transcript_sha256,
      sha(request.body.turns.map((t) => `${t.role}:${t.text}`).join('\n')),
    );
    assert.notEqual(request.body.transcript_sha256, sha(fs.readFileSync(transcript, 'utf8')));
  } finally {
    await stub.close();
  }
});

test('an optional field that is absent is omitted, never sent as null', async () => {
  const stub = await stubServer();
  try {
    const bare = { session_id: 'sess-2', transcript_path: transcript, stop_hook_active: false };
    assert.equal(await runCapture(bare, baseEnv(stub.url)), 'ok');
    const body = stub.requests[0].body;
    assert.equal(Object.hasOwn(body, 'cwd'), false, 'cwd is absent, so it is not in the body');
    assert.equal(Object.hasOwn(body, 'hook_event_name'), false);
    assert.deepEqual(Object.keys(body).sort(), [
      'captured_at',
      'session_id',
      'transcript_sha256',
      'turns',
    ]);
  } finally {
    await stub.close();
  }
});

test('a hook input without session_id posts nothing', async () => {
  const stub = await stubServer();
  try {
    // Nothing to attribute the capture to, and the endpoint requires the field.
    for (const bad of [{}, { session_id: '' }, { session_id: 42 }]) {
      assert.equal(
        await runCapture({ ...payload(), ...bad, session_id: bad.session_id }, baseEnv(stub.url)),
        'no session_id',
      );
    }
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});

test('stop_hook_active, a disabled capture and a missing env send nothing', async () => {
  const stub = await stubServer();
  try {
    assert.equal(
      await runCapture({ ...payload(), stop_hook_active: true }, baseEnv(stub.url)),
      'stop_hook_active',
    );
    assert.equal(
      await runCapture(payload(), { ...baseEnv(stub.url), MOZECEK_AUTO_CAPTURE: '0' }),
      'capture disabled',
    );
    assert.equal(await runCapture(payload(), { MOZECEK_AUTO_CAPTURE: '1' }), 'not configured');
    assert.equal(
      await runCapture(payload(), { ...baseEnv(stub.url), MOZECEK_TOKEN: '' }),
      'not configured',
    );
    assert.equal(
      await runCapture(
        { ...payload(), transcript_path: path.join(dir, 'nope.jsonl') },
        baseEnv(stub.url),
      ),
      'transcript unreadable',
    );
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});

test('takes the agent slug from the token when nothing names one', async () => {
  const stub = await stubServer();
  try {
    const { MOZECEK_AGENT: _dropped, ...env } = baseEnv(stub.url);
    assert.equal(await runCapture(payload(), env), 'ok');
    assert.equal(stub.requests[0].url, '/api/agents/demo/capture');

    // An explicit slug still wins, which is what lets one run act for another agent.
    stub.requests.length = 0;
    assert.equal(
      await runCapture(payload(), { ...env, MOZECEK_TOKEN: 'mz_kuba_0123456789abcdef' }),
      'ok',
    );
    assert.equal(stub.requests[0].url, '/api/agents/kuba/capture');
  } finally {
    await stub.close();
  }
});

test('reads plugin options when the environment carries no MOZECEK_ variables', async () => {
  const stub = await stubServer();
  try {
    assert.equal(
      await runCapture(payload(), {
        CLAUDE_PLUGIN_OPTION_AUTO_CAPTURE: 'true',
        CLAUDE_PLUGIN_OPTION_URL: stub.url,
        CLAUDE_PLUGIN_OPTION_TOKEN: 'mz_kuba_0123456789abcdef',
      }),
      'ok',
    );
    assert.equal(stub.requests[0].url, '/api/agents/kuba/capture');
    assert.equal(stub.requests[0].auth, 'Bearer mz_kuba_0123456789abcdef');
  } finally {
    await stub.close();
  }
});

test('resolveConfig names why it will not run', () => {
  const token = 'mz_kuba_0123456789abcdef';
  assert.equal(resolveConfig({}), 'capture disabled');
  assert.equal(resolveConfig({ MOZECEK_AUTO_CAPTURE: '1' }), 'not configured');
  // A token alone is not enough: there is no default address, so an install that forgot
  // MOZECEK_URL stays quiet rather than pointing somewhere nobody chose.
  assert.equal(
    resolveConfig({ MOZECEK_AUTO_CAPTURE: '1', MOZECEK_TOKEN: token }),
    'not configured',
  );
  // A token that is not an api key carries no slug, and nothing else names one.
  assert.equal(
    resolveConfig({
      MOZECEK_AUTO_CAPTURE: '1',
      MOZECEK_TOKEN: 'operator-token',
      MOZECEK_URL: 'http://x',
    }),
    'invalid agent slug',
  );
  // The environment wins over the plugin option.
  assert.deepEqual(
    resolveConfig({
      MOZECEK_AUTO_CAPTURE: '1',
      MOZECEK_URL: 'http://x',
      MOZECEK_TOKEN: token,
      CLAUDE_PLUGIN_OPTION_TOKEN: 'mz_other_0123456789abcdef',
    }),
    { base: 'http://x', token, agent: 'kuba' },
  );
  // A trailing slash on the URL must not produce a double slash in the request path.
  assert.equal(
    resolveConfig({ MOZECEK_AUTO_CAPTURE: '1', MOZECEK_TOKEN: token, MOZECEK_URL: 'http://x/' })
      .base,
    'http://x',
  );
});

test('agentFromToken reads the slug out of an api key', () => {
  assert.equal(agentFromToken('mz_demo_0123456789abcdef'), 'demo');
  assert.equal(agentFromToken('mz_kuba-2_abc'), 'kuba-2');
  assert.equal(agentFromToken('operator-token'), '');
  assert.equal(agentFromToken('mz_nokey'), '');
});

/** Runs the hook as Claude Code does: a child process fed the payload on stdin. */
function runHook(entry, input, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

test('the hook runs when Claude Code reaches it through a symlink', async () => {
  // Node realpaths the entry point before it sets import.meta.url, so a guard comparing the
  // raw argv path would skip main() and the hook would look like a silent success.
  const stub = await stubServer();
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozecek-hooklink-'));
  try {
    const link = path.join(linkDir, 'capture-link.mjs');
    fs.symlinkSync(fileURLToPath(new URL('./capture.mjs', import.meta.url)), link);
    const run = await runHook(link, JSON.stringify(payload()), baseEnv(stub.url));
    assert.equal(run.code, 0, run.err);
    assert.equal(run.out, '', 'a hook never writes to stdout');
    assert.equal(stub.requests.length, 1, 'the symlinked entry point still posted the session');
    assert.equal(stub.requests[0].url, '/api/agents/demo/capture');
  } finally {
    fs.rmSync(linkDir, { recursive: true, force: true });
    await stub.close();
  }
});

test('a failing service resolves quietly instead of throwing', async () => {
  const stub = await stubServer({ status: 500 });
  try {
    assert.equal(await runCapture(payload(), baseEnv(stub.url)), 'http 500');
  } finally {
    await stub.close();
  }
  // Nothing listening at all: the promise still resolves, so the hook can exit 0.
  const dead = await runCapture(payload(), baseEnv('http://127.0.0.1:1'));
  assert.equal(dead, 'error');
});
