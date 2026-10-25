// Gate entry point. The OpenCode plugin calls `gate.mjs --json` on every `session.idle` event and
// gets `{"allow":true}` or `{"allow":false,"reason":"..."}`. Without `--json` it emits the legacy
// Claude Code Stop-hook payload, which is handy for scripts and CI.
//
// It fails open on any internal error: a broken gate must never trap an OpenCode session.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin, forgeDir, posix } from './lib/util.mjs';
import { loadState, saveState, loadArtifacts } from './lib/state.mjs';
import { decide } from './lib/gate-logic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = `node "${posix(path.join(here, 'forge.mjs'))}"`;
const json = process.argv.includes('--json');

let input = {};
try { input = JSON.parse((await readStdin()) || '{}'); } catch { /* ignore */ }
const project = path.resolve(input.cwd || process.env.FORGE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd());

const reply = (allow, reason) => {
  if (json) process.stdout.write(JSON.stringify({ allow, ...(reason ? { reason } : {}) }));
  else if (!allow) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
};

try {
  const state = loadState(project);
  if (!state || !['running', 'delivering'].includes(state.status)) reply(true);
  if (state.session_id && input.session_id && state.session_id !== input.session_id) reply(true);
  if (!state.session_id && input.session_id) state.session_id = input.session_id;

  const art = loadArtifacts(project, state.round);
  const res = decide(state, art, Date.now(), { cli });
  saveState(project, res.state);
  reply(res.allow, res.reason);
} catch (e) {
  try {
    fs.mkdirSync(forgeDir(project), { recursive: true });
    fs.appendFileSync(path.join(forgeDir(project), 'gate-errors.log'), `${new Date().toISOString()} ${e?.stack || e}\n`);
  } catch { /* ignore */ }
  reply(true);
}
