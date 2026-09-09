import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  resolveConfig,
  parseSse,
  Session,
  forward,
  endSession,
  transportError,
  main,
} from './mcp-proxy.mjs';

const TOKEN = 'mz_agent_test';
const URL_BASE = 'https://mozecek.example.com';

/** Minimal stand-in for a fetch Response, enough for what the proxy reads. */
const reply = (
  body,
  { status = 200, contentType = 'application/json', headers = {} } = {},
) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': contentType, ...headers }),
  text: async () => body,
});

const collect = (stream) => {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  return () => chunks.join('');
};

test('the address and key come from the environment first', () => {
  const c = resolveConfig({ MOZECEK_URL: URL_BASE, MOZECEK_TOKEN: TOKEN });
  assert.deepEqual(c, { url: URL_BASE, token: TOKEN, missing: [] });
});

test('Claude Code plugin options are the second source', () => {
  const c = resolveConfig({ CLAUDE_PLUGIN_OPTION_URL: URL_BASE, CLAUDE_PLUGIN_OPTION_TOKEN: TOKEN });
  assert.equal(c.url, URL_BASE);
  assert.equal(c.token, TOKEN);
});

test('PLUGIN_DATA credentials are the portable fallback, and losing to the environment', () => {
  const file = () => JSON.stringify({ url: 'https://from-file.example.com', token: 'mz_file' });
  const only = resolveConfig({ PLUGIN_DATA: '/data' }, file);
  assert.equal(only.url, 'https://from-file.example.com');
  assert.equal(only.token, 'mz_file');

  const both = resolveConfig({ PLUGIN_DATA: '/data', MOZECEK_URL: URL_BASE, MOZECEK_TOKEN: TOKEN }, file);
  assert.equal(both.url, URL_BASE, 'the environment wins');
  assert.equal(both.token, TOKEN);
});

test('a missing or broken credentials file is not an error by itself', () => {
  const throws = () => {
    throw new Error('ENOENT');
  };
  assert.deepEqual(resolveConfig({ PLUGIN_DATA: '/data' }, throws).missing.length, 2);
  assert.deepEqual(resolveConfig({ PLUGIN_DATA: '/data' }, () => 'not json').missing.length, 2);
});

test('there is no default address, and both gaps are named', () => {
  assert.deepEqual(resolveConfig({}).missing, ['address (MOZECEK_URL)', 'agent key (MOZECEK_TOKEN)']);
  const noToken = resolveConfig({ MOZECEK_URL: URL_BASE });
  assert.deepEqual(noToken.missing, ['agent key (MOZECEK_TOKEN)']);
  // Blank is as absent as unset, so an empty variable cannot produce "Bearer ".
  assert.deepEqual(resolveConfig({ MOZECEK_URL: '  ', MOZECEK_TOKEN: '' }).missing.length, 2);
});

test('a trailing slash in the address does not survive into the path', () => {
  assert.equal(resolveConfig({ MOZECEK_URL: `${URL_BASE}//`, MOZECEK_TOKEN: TOKEN }).url, URL_BASE);
});

test('SSE bodies yield the JSON-RPC messages they carry', () => {
  const body = [
    ': a comment',
    'event: message',
    'id: 1',
    'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
    '',
    'data: {"jsonrpc":"2.0","method":"notifications/message"}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  assert.deepEqual(parseSse(body), [
    { jsonrpc: '2.0', id: 1, result: { ok: true } },
    { jsonrpc: '2.0', method: 'notifications/message' },
  ]);
});

test('a data payload split over several lines is rejoined', () => {
  const body = 'data: {"jsonrpc":"2.0",\ndata: "id":7,"result":1}\n\n';
  assert.deepEqual(parseSse(body), [{ jsonrpc: '2.0', id: 7, result: 1 }]);
});

test('non-JSON SSE payloads are dropped rather than forwarded', () => {
  assert.deepEqual(parseSse('data: hello\n\n'), []);
});

test('the key travels in the header and never in the URL', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return reply('{"jsonrpc":"2.0","id":1,"result":{}}');
  };
  await forward({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {
    url: URL_BASE,
    token: TOKEN,
    session: new Session(),
    fetchImpl,
  });
  assert.equal(seen.url, `${URL_BASE}/mcp`);
  assert.equal(seen.init.headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(!seen.url.includes(TOKEN), 'a token in a URL would land in proxy logs and Referer');
  assert.match(seen.init.headers.accept, /text\/event-stream/);
});

test('the session id from initialize rides along on later calls', async () => {
  const session = new Session();
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(init.headers);
    return calls.length === 1
      ? reply('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}', {
          headers: { 'mcp-session-id': 'sess-42' },
        })
      : reply('{"jsonrpc":"2.0","id":2,"result":{}}');
  };
  const opts = { url: URL_BASE, token: TOKEN, session, fetchImpl };
  await forward({ jsonrpc: '2.0', id: 1, method: 'initialize' }, opts);
  await forward({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, opts);

  assert.equal(calls[0]['mcp-session-id'], undefined, 'nothing to send before the handshake');
  assert.equal(calls[1]['mcp-session-id'], 'sess-42');
  assert.equal(calls[1]['mcp-protocol-version'], '2025-06-18');
});

test('202 with no body is the right answer to a notification and produces nothing', async () => {
  const out = await forward({ jsonrpc: '2.0', method: 'notifications/initialized' }, {
    url: URL_BASE,
    token: TOKEN,
    session: new Session(),
    fetchImpl: async () => reply('', { status: 202 }),
  });
  assert.deepEqual(out, []);
});

test('an HTTP failure becomes a JSON-RPC error so the client is not left waiting', async () => {
  const out = await forward({ jsonrpc: '2.0', id: 9, method: 'tools/call' }, {
    url: URL_BASE,
    token: TOKEN,
    session: new Session(),
    fetchImpl: async () => reply('unauthorized', { status: 401, contentType: 'text/plain' }),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 9);
  assert.match(out[0].error.message, /HTTP 401/);
});

test('a server that phrases its own JSON-RPC error has it passed through untouched', async () => {
  const body = '{"jsonrpc":"2.0","id":9,"error":{"code":-32602,"message":"bad params"}}';
  const out = await forward({ jsonrpc: '2.0', id: 9, method: 'tools/call' }, {
    url: URL_BASE,
    token: TOKEN,
    session: new Session(),
    fetchImpl: async () => reply(body, { status: 400 }),
  });
  assert.deepEqual(out, [JSON.parse(body)]);
});

test('a failed notification yields no reply, because none was owed', async () => {
  const out = await forward({ jsonrpc: '2.0', method: 'notifications/cancelled' }, {
    url: URL_BASE,
    token: TOKEN,
    session: new Session(),
    fetchImpl: async () => reply('boom', { status: 500, contentType: 'text/plain' }),
  });
  assert.deepEqual(out, []);
});

test('the session is closed on the way out, and only when there is one', async () => {
  const methods = [];
  const fetchImpl = async (_url, init) => {
    methods.push(init.method);
    return reply('', { status: 204 });
  };
  const session = new Session();
  await endSession({ url: URL_BASE, token: TOKEN, session, fetchImpl });
  assert.deepEqual(methods, [], 'no handshake, nothing to end');

  session.id = 'sess-1';
  await endSession({ url: URL_BASE, token: TOKEN, session, fetchImpl });
  assert.deepEqual(methods, ['DELETE']);
});

test('a DELETE the server refuses does not turn shutdown into a failure', async () => {
  const session = new Session();
  session.id = 'sess-1';
  await assert.doesNotReject(
    endSession({
      url: URL_BASE,
      token: TOKEN,
      session,
      fetchImpl: async () => {
        throw new Error('connection reset');
      },
    }),
  );
});

test('end to end: lines in, lines out, in order', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const read = collect(stdout);

  const run = main({
    env: { MOZECEK_URL: URL_BASE, MOZECEK_TOKEN: TOKEN },
    stdin,
    stdout,
    stderr,
    fetchImpl: async (_url, init) => {
      const sent = JSON.parse(init.body);
      if (sent.method === 'initialize') {
        return reply(`{"jsonrpc":"2.0","id":${sent.id},"result":{"protocolVersion":"2025-06-18"}}`, {
          headers: { 'mcp-session-id': 'sess-7' },
        });
      }
      return reply(
        `data: {"jsonrpc":"2.0","id":${sent.id},"result":{"tools":[]}}\n\n`,
        { contentType: 'text/event-stream' },
      );
    },
  });

  stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  stdin.write('not json\n');
  stdin.write('\n');
  stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  stdin.end();

  assert.equal(await run, 0);
  const out = read().trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((m) => m.id), [1, 2], 'replies keep the order of the requests');
  assert.deepEqual(out[1].result, { tools: [] }, 'the SSE answer was decoded');
});

test('without an address it exits non-zero, says why, and writes nothing to stdout', async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outText = collect(stdout);
  const errText = collect(stderr);

  const code = await main({ env: {}, stdin: new PassThrough(), stdout, stderr });

  assert.equal(code, 1);
  assert.equal(outText(), '', 'a half-spoken protocol is worse than none');
  assert.match(errText(), /MOZECEK_URL/);
  assert.match(errText(), /no default address/);
});

test('a transport error is shaped as a JSON-RPC error', () => {
  const e = transportError(3, 'connection reset');
  assert.equal(e.id, 3);
  assert.equal(e.jsonrpc, '2.0');
  assert.match(e.error.message, /mozecek: connection reset/);
});
