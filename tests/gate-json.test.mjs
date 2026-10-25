// The OpenCode plugin calls `gate.mjs --json` on every session.idle. This test pins that contract:
// a blocked loop returns a reason, the loop binds to the first session, and other sessions are let go.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpProject, rawPlan } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORGE = path.join(root, 'scripts', 'forge.mjs');
const GATE = path.join(root, 'scripts', 'gate.mjs');

const proj = tmpProject();
const env = { ...process.env, FORGE_PROJECT_DIR: proj };
const forge = (args, input) => spawnSync(process.execPath, [FORGE, ...args], { cwd: proj, env, encoding: 'utf8', input });
const gate = (sessionID) => {
  const r = spawnSync(process.execPath, [GATE, '--json'], {
    cwd: proj,
    env,
    encoding: 'utf8',
    input: JSON.stringify({ cwd: proj, session_id: sessionID }),
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('gate --json: blocks an unverified round, binds the session, and releases other sessions', () => {
  assert.equal(forge(['init', 'build a tiny verified tool', '--auto']).status, 0);
  fs.writeFileSync(path.join(proj, '.forge', 'plan.draft.json'), JSON.stringify(rawPlan(), null, 2));
  assert.equal(forge(['plan-set']).status, 0);
  assert.equal(forge(['start']).status, 0);

  const first = gate('session-1');
  assert.equal(first.allow, false);
  assert.match(first.reason, /not accepted until it is verified/);
  assert.match(first.reason, /forge\/supervisor/);

  const state = JSON.parse(fs.readFileSync(path.join(proj, '.forge', 'state.json'), 'utf8'));
  assert.equal(state.session_id, 'session-1');

  // OpenCode can run other sessions in the same location; a different session must not be trapped.
  const other = gate('session-2');
  assert.equal(other.allow, true);
});

test('gate --json: an inactive loop always allows the stop', () => {
  assert.equal(forge(['abort']).status, 0);
  assert.deepEqual(gate('session-1'), { allow: true });
});

test('gate --json: a broken state file fails open', () => {
  fs.writeFileSync(path.join(proj, '.forge', 'state.json'), '{not json');
  assert.deepEqual(gate('session-1'), { allow: true });
});
