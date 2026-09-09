// mcp-proxy.mjs — speaks MCP over stdio to the client, Streamable HTTP to a Mozeček instance.
//
// Why this exists. Mozeček is a remote server reached with a per-user address and a per-agent
// bearer key. Agent Plugins 1.0.0 cannot express that: placeholder expansion does not reach
// remote URLs or headers, and "configured headers are literal, visible package data and must not
// contain credentials or secrets". So a portable `mcp.json` cannot carry either value. A stdio
// server can: the client starts this file, and the address and key arrive out of band, never in
// the package. That is what makes the plugin work in every Agent Plugins client instead of only
// in the one whose config format happens to interpolate variables.
//
// No default address, on purpose (AGENTS.md). Without an address this exits non-zero with a
// message on stderr rather than guessing a host, because a plugin that carries its publisher's
// address would send every install that forgot the variable there.
//
// Framing: stdio MCP is newline-delimited JSON-RPC 2.0. Streamable HTTP answers a POST with
// 202 and no body, a single JSON object, or an SSE stream carrying one or more messages. Each
// message that comes back becomes one line on stdout.

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH_SCHEME = 'Bearer';
/** JSON-RPC: server error range, used when the transport fails rather than the method. */
const TRANSPORT_ERROR = -32001;

/**
 * Address and key, in precedence order:
 *   1. MOZECEK_URL / MOZECEK_TOKEN in the environment — works in every client that passes the
 *      environment through, and is what Claude Code's `env` block sets today.
 *   2. CLAUDE_PLUGIN_OPTION_URL / _TOKEN — exported by Claude Code when the plugin's userConfig
 *      is filled in, so a key kept in the OS keychain never reaches settings.json.
 *   3. ${PLUGIN_DATA}/credentials.json — the portable route. Agent Plugins guarantees
 *      PLUGIN_DATA is writable and survives plugin updates, so a client with no way to set
 *      per-user variables can still hold a key there.
 * Nothing is read from the package itself.
 */
export function resolveConfig(env = process.env, readFile = readFileSync) {
  const fromFile = readCredentialsFile(env, readFile);
  const url = first(env.MOZECEK_URL, env.CLAUDE_PLUGIN_OPTION_URL, fromFile.url);
  const token = first(env.MOZECEK_TOKEN, env.CLAUDE_PLUGIN_OPTION_TOKEN, fromFile.token);
  const missing = [];
  if (!url) missing.push('address (MOZECEK_URL)');
  if (!token) missing.push('agent key (MOZECEK_TOKEN)');
  // One trailing slash is tolerated here because this file builds the path itself; `.mcp.json`
  // cannot, which is why the README is strict about it.
  return { url: url ? url.replace(/\/+$/, '') : null, token: token ?? null, missing };
}

function first(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

function readCredentialsFile(env, readFile) {
  if (!env.PLUGIN_DATA) return {};
  try {
    const parsed = JSON.parse(readFile(join(env.PLUGIN_DATA, 'credentials.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return { url: parsed.url, token: parsed.token };
  } catch {
    // Absent or unreadable is the normal case: most clients pass the environment instead.
    return {};
  }
}

/**
 * Splits an SSE body into the JSON-RPC messages it carries. Only `data:` matters here; MCP puts
 * one JSON-RPC message in each event, and `id:`/`event:`/retry lines and comments are ignored.
 * A blank line ends an event, and a multi-line data payload is joined with newlines per the SSE
 * grammar.
 */
export function parseSse(body) {
  const messages = [];
  let data = [];
  const flush = () => {
    if (data.length === 0) return;
    const text = data.join('\n');
    data = [];
    if (text === '[DONE]') return;
    try {
      messages.push(JSON.parse(text));
    } catch {
      // A payload that is not JSON-RPC is not ours to forward.
    }
  };
  for (const raw of body.split(/\r\n|\r|\n/)) {
    if (raw === '') {
      flush();
      continue;
    }
    if (raw.startsWith(':')) continue;
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? '' : raw.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
  }
  flush();
  return messages;
}

/** A session id handed out by the server on initialize has to ride along on every later call. */
export class Session {
  constructor() {
    this.id = null;
    this.protocolVersion = null;
  }

  headers(token) {
    const headers = {
      'content-type': 'application/json',
      // Both are offered because the server picks the shape of its own answer.
      accept: 'application/json, text/event-stream',
      authorization: `${AUTH_SCHEME} ${token}`,
    };
    if (this.id) headers['mcp-session-id'] = this.id;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;
    return headers;
  }

  /** Remembers what the handshake settled on, so later requests identify themselves correctly. */
  learn(response, message) {
    const id = response.headers.get('mcp-session-id');
    if (id) this.id = id;
    const version = message?.result?.protocolVersion;
    if (version) this.protocolVersion = version;
  }
}

/** True for a request, which owes the client a reply; a notification carries no id. */
function isRequest(message) {
  return message !== null && typeof message === 'object' && 'method' in message && 'id' in message;
}

export function transportError(id, detail) {
  return { jsonrpc: '2.0', id, error: { code: TRANSPORT_ERROR, message: `mozecek: ${detail}` } };
}

/**
 * Sends one client message upstream and returns whatever came back, already decoded. A 202 with
 * no body is the documented answer to a notification and yields nothing.
 */
export async function forward(message, { url, token, session, fetchImpl = fetch }) {
  const response = await fetchImpl(`${url}/mcp`, {
    method: 'POST',
    headers: session.headers(token),
    body: JSON.stringify(message),
  });

  if (response.status === 202 || response.status === 204) return [];

  const body = await response.text();
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const messages = contentType.includes('text/event-stream')
    ? parseSse(body)
    : decodeJson(body);

  if (!response.ok && messages.length === 0) {
    // The server failed in a way it did not phrase as JSON-RPC, so say so in JSON-RPC instead of
    // leaving the client waiting for a reply that will never come.
    const detail = `HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`;
    return isRequest(message) ? [transportError(message.id, detail)] : [];
  }

  for (const m of messages) session.learn(response, m);
  return messages;
}

function decodeJson(body) {
  if (body.trim() === '') return [];
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** Ends the server-side session on the way out; a server that does not support it is fine. */
export async function endSession({ url, token, session, fetchImpl = fetch }) {
  if (!session.id) return;
  try {
    await fetchImpl(`${url}/mcp`, { method: 'DELETE', headers: session.headers(token) });
  } catch {
    // Shutdown is not a place to fail.
  }
}

export async function main({
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = fetch,
} = {}) {
  const { url, token, missing } = resolveConfig(env);
  if (missing.length > 0) {
    stderr.write(
      `mozecek: missing ${missing.join(' and ')}. Set MOZECEK_URL and MOZECEK_TOKEN, fill in the ` +
        `plugin's options, or write {"url":…,"token":…} to $PLUGIN_DATA/credentials.json. ` +
        `There is no default address.\n`,
    );
    return 1;
  }

  const session = new Session();
  const write = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  // Messages are handled one at a time: a client may not send the next request before the
  // handshake it depends on has been answered.
  let queue = Promise.resolve();

  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      stderr.write('mozecek: ignoring a line that is not JSON\n');
      continue;
    }
    queue = queue.then(async () => {
      try {
        for (const reply of await forward(message, { url, token, session, fetchImpl })) write(reply);
      } catch (error) {
        const detail = error?.message ?? String(error);
        if (isRequest(message)) write(transportError(message.id, detail));
        else stderr.write(`mozecek: ${detail}\n`);
      }
    });
    await queue;
  }

  await endSession({ url, token, session, fetchImpl });
  return 0;
}

// Only run when started as a program, so the tests can import the pieces above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
