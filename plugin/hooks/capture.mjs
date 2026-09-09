#!/usr/bin/env node
// capture.mjs — Stop hook: hands the finished session to Mozecek as an episodic capture.
//
// Node >= 20, no dependencies. The hook is opt-in and silent by design: it exits 0 and
// prints nothing whenever it cannot or must not run, so a memory service that is down,
// unconfigured or slow can never break a Claude Code session. It never exits 2 (which would
// block the Stop event) and it never writes to stdout.
//
// It stays quiet when:
//   stop_hook_active === true       (we are already inside a stop-hook continuation)
//   capture is off                  (off unless explicitly turned on)
//   the token is missing            (nothing to authenticate with)
//   the agent cannot be determined  (neither configured nor derivable from the token)
//   session_id is missing           (there would be nothing to attribute the capture to)
//   transcript_path is missing or unreadable
//
// Configuration reaches the hook two ways, and it reads both. A headless run sets MOZECEK_* in
// the environment. An interactive install stores the same values as plugin options, which Claude
// Code exports as CLAUDE_PLUGIN_OPTION_*; the environment wins so a run can override an installed
// value. The agent slug is the one piece nobody should have to type: an api key is
// `mz_<slug>_<random>`, so the token already carries it.
//
// There is no default address. A plugin that shipped one would point every install at whoever
// published it, and a missing MOZECEK_URL would look like it worked.
//
// The capture endpoint validates a strict object: session_id is a required string, cwd is an
// optional string, and no field accepts null. An absent field is therefore omitted from the
// body rather than sent as null, which the server would reject.
//
// What leaves the machine: user and assistant turns only. A tool_use part is reduced to
// `[tool: <name>]` and a tool_result part is dropped entirely — tool output is where secrets,
// file contents and third-party data live, and none of that belongs in a memory service.
// What survives that filter still goes through redactSecrets() before the POST.
//
// `transcript_sha256` keeps the name the capture API is specified with, but it hashes the
// payload this hook actually sends — the redacted, trimmed turns — not the raw transcript
// file on disk. That is what duplicate detection needs: two Stop events over the same
// conversation must agree, and re-hashing the file would disagree as soon as the session
// grew by one tool call that never leaves the machine. It is therefore not a checksum of
// transcript_path and must never be used to verify that file.
//
// Env: MOZECEK_TOKEN (required), MOZECEK_URL (required, no default), MOZECEK_AGENT
//      (default: the slug inside the token), MOZECEK_AUTO_CAPTURE, MOZECEK_CAPTURE_MAX_KB
//      (default 256), MOZECEK_DEBUG. Each MOZECEK_X above also reads CLAUDE_PLUGIN_OPTION_X.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_TURNS = 400;
export const MAX_TOTAL_CHARS = 60_000;
const REQUEST_TIMEOUT_MS = 8000;
// Same default as the plugin's .mcp.json, so a colleague configures a token and nothing else.

// Ordered: the multi-line private key block has to win before the single-line patterns run.
// Breadth is deliberate: every GitHub token prefix, not
// just ghp_, and Slack's refresh and app-level tokens next to the bot and user ones. This is
// redaction rather than detection, so the length floors are the looser of the two.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'private-key'],
  [/xox[baprs]-[A-Za-z0-9-]+/g, 'slack-token'],
  [/xapp-[A-Za-z0-9-]+/g, 'slack-token'],
  [/AKIA[0-9A-Z]{16}/g, 'aws-key'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'github-token'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'github-token'],
  [/GOCSPX-[A-Za-z0-9_-]+/g, 'google-secret'],
  [/mz_[a-z0-9-]+_[A-Za-z0-9_-]{16,}/g, 'mozecek-token'],
  [/sk-[A-Za-z0-9_-]{16,}/g, 'api-key'],
  [/Bearer [A-Za-z0-9._-]{16,}/g, 'bearer'],
];

/** Replaces every secret-shaped substring with `[redacted:<type>]`. */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let result = text;
  for (const [pattern, label] of SECRET_PATTERNS)
    result = result.replace(pattern, `[redacted:${label}]`);
  return result;
}

function readTail(file, size, window) {
  const start = Math.max(0, size - window);
  const length = size - start;
  if (length <= 0) return { start, text: '' };
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(file, 'r');
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(handle, buffer, 0, length, start);
  } finally {
    fs.closeSync(handle);
  }
  // A short read must not turn the unwritten tail of the buffer into NUL characters.
  return { start, text: buffer.subarray(0, bytesRead).toString('utf8') };
}

/**
 * The last `maxBytes` bytes of a file as text. A tail almost always starts in the middle of a
 * line, and half a JSON object is not worth parsing, so the first partial line is dropped.
 *
 * One line can be longer than the whole window — a single turn that pasted a large file is
 * exactly that case — and dropping the partial line would then leave nothing at all. So the
 * window doubles up to 4x before the hook gives up, which keeps a long last turn capturable
 * without ever reading an unbounded transcript.
 */
export function tailFile(file, maxBytes) {
  const size = fs.statSync(file).size;
  for (let window = Math.max(1, maxBytes), attempt = 0; attempt < 3; window *= 2, attempt += 1) {
    const { start, text } = readTail(file, size, window);
    if (start === 0) return text; // the whole file: there is no partial first line to drop
    const newline = text.indexOf('\n');
    // An empty rest means the window held nothing but the tail of one line (the newline it
    // found was that line's own terminator), so widening is exactly what is called for.
    const rest = newline === -1 ? '' : text.slice(newline + 1);
    if (rest) return rest;
  }
  return '';
}

function partsToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const pieces = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    // tool_result is dropped without a placeholder: it may carry secrets or private files.
    if (part.type === 'text' && typeof part.text === 'string') pieces.push(part.text);
    else if (part.type === 'tool_use')
      pieces.push(`[tool: ${typeof part.name === 'string' ? part.name : 'unknown'}]`);
  }
  return pieces.join('\n').trim();
}

/**
 * JSONL transcript -> the turns worth remembering, oldest first, already redacted and
 * trimmed to MAX_TURNS / MAX_TOTAL_CHARS (the oldest turns go first).
 */
export function extractTurns(jsonl, { maxTurns = MAX_TURNS, maxChars = MAX_TOTAL_CHARS } = {}) {
  const turns = [];
  for (const line of String(jsonl ?? '').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a truncated or non-JSON line is not a reason to lose the rest
    }
    if (!entry || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const text = redactSecrets(partsToText(entry.message?.content));
    if (!text) continue;
    const turn = { role: entry.type, text };
    if (typeof entry.timestamp === 'string' && entry.timestamp) turn.ts = entry.timestamp;
    turns.push(turn);
  }
  while (turns.length > maxTurns) turns.shift();
  let total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (turns.length > 1 && total > maxChars) total -= turns.shift().text.length;
  if (turns.length === 1 && turns[0].text.length > maxChars)
    turns[0].text = turns[0].text.slice(-maxChars);
  return turns;
}

const debug = (env, message) => {
  if (env.MOZECEK_DEBUG === '1') process.stderr.write(`mozecek capture: ${message}\n`);
};

/** Never throws, never returns a non-zero intent. Resolves to a short reason string. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The environment wins over the plugin option, so a single run can override an installed value. */
function setting(env, name) {
  const direct = (env[`MOZECEK_${name}`] || '').trim();
  if (direct) return direct;
  return (env[`CLAUDE_PLUGIN_OPTION_${name}`] || '').trim();
}

/** `mz_<slug>_<random>`: a slug never contains an underscore, so the second field is the slug. */
export function agentFromToken(token) {
  const parts = token.split('_');
  if (parts.length < 3 || parts[0] !== 'mz') return '';
  return parts[1];
}

/**
 * Resolves what the hook needs. Returns the config, or the reason it will not run — the same
 * vocabulary the hook returns to its caller, so a MOZECEK_DEBUG line names the actual problem.
 * Exported so the resolution order can be tested without a fake transcript.
 */
export function resolveConfig(env) {
  const enabled = setting(env, 'AUTO_CAPTURE');
  if (enabled !== '1' && enabled !== 'true') return 'capture disabled';
  const token = setting(env, 'TOKEN');
  const base = (setting(env, 'URL') || '').replace(/\/+$/, '');
  if (!token || !base) return 'not configured';
  const agent = setting(env, 'AGENT') || agentFromToken(token);
  if (!SLUG.test(agent)) return 'invalid agent slug';
  return { base, token, agent };
}

export async function runCapture(payload, env = process.env, { fetchImpl = fetch } = {}) {
  try {
    if (!payload || typeof payload !== 'object') return 'no payload';
    if (payload.stop_hook_active === true) return 'stop_hook_active';
    const config = resolveConfig(env);
    if (typeof config === 'string') return config;
    const { base, token, agent } = config;

    // Required by the schema, and a capture with no session to attach it to is worthless.
    const sessionId =
      typeof payload.session_id === 'string' && payload.session_id ? payload.session_id : null;
    if (!sessionId) return 'no session_id';

    const transcript = payload.transcript_path;
    if (typeof transcript !== 'string' || !transcript) return 'no transcript_path';
    let raw;
    try {
      raw = tailFile(transcript, Math.max(1, Number(env.MOZECEK_CAPTURE_MAX_KB) || 256) * 1024);
    } catch {
      return 'transcript unreadable';
    }
    const turns = extractTurns(raw);
    if (turns.length === 0) return 'nothing to capture';

    const body = {
      session_id: sessionId,
      captured_at: new Date().toISOString(),
      // sha256 of the captured payload (redacted turns), not of the transcript file — see the header.
      transcript_sha256: createHash('sha256')
        .update(turns.map((t) => `${t.role}:${t.text}`).join('\n'))
        .digest('hex'),
      turns,
    };
    // Optional fields: present only when the hook input actually carried them.
    if (typeof payload.cwd === 'string' && payload.cwd) body.cwd = payload.cwd;
    if (typeof payload.hook_event_name === 'string' && payload.hook_event_name) {
      body.hook_event_name = payload.hook_event_name;
    }
    const response = await fetchImpl(`${base}/api/agents/${agent}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      debug(env, `POST returned ${response.status}`);
      return `http ${response.status}`;
    }
    debug(env, `captured ${turns.length} turn(s)`);
    return 'ok';
  } catch (error) {
    debug(env, String(error?.message || error));
    return 'error';
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main() {
  let payload = null;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return 0; // no usable hook input: stay silent
  }
  await runCapture(payload);
  return 0;
}

// realpath on both sides: node resolves the entry point's symlinks before it sets
// import.meta.url, so comparing the raw argv path would skip main() whenever Claude Code
// reaches the hook through a linked plugin directory.
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 0;
    },
  );
}
