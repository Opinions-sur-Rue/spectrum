// Local-only coverage check: npm ci in frontend first. Never starts browsers or servers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const workflow = readFileSync(new URL('workflows/release-v2-beta.yml', new URL('../', import.meta.url)), 'utf8');
const frontend = fileURLToPath(new URL('frontend/', root));
function job(name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:|$(?![\\s\\S]))`, 'm'));
  assert(match, `Missing job: ${name}`);
  return match[1];
}
function list(suite, args = []) {
  const report = JSON.parse(execFileSync(process.execPath, [
    'node_modules/@playwright/test/cli.js', 'test', '--config', `playwright.${suite}.config.ts`,
    ...args, '--list', '--reporter=json'
  ], { cwd: frontend, encoding: 'utf8', timeout: 30000, env: { ...process.env, CI: 'true' } }));
  assert.deepEqual(report.errors, []);
  const cases = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
          cases.push(JSON.stringify([test.projectName, spec.file, spec.line, spec.column, spec.title]));
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  assert(cases.length > 0, `Empty plan: ${suite} ${args.join(' ')}`);
  return cases;
}
function exactlyOnce(label, baseline, matrix) {
  assert.equal(new Set(baseline).size, baseline.length, `${label}: duplicate baseline cases`);
  assert.equal(new Set(matrix).size, matrix.length, `${label}: duplicate matrix cases`);
  assert.deepEqual([...matrix].sort(), [...baseline].sort(), `${label}: coverage changed`);
  console.log(`${label}: ${matrix.length} cases, exactly once`);
}

const ui = job('frontend-ui');
assert(ui.includes('--fully-parallel'), 'UI sharding must distribute individual cases');
const cells = [...ui.matchAll(/^          - id: (.+)\n((?:            .+\n)+)/gm)].map((match) => {
  const cell = { id: match[1] };
  for (const field of match[2].matchAll(/^            (\w+): (.+)$/gm)) cell[field[1]] = field[2];
  return cell;
});
assert.equal(cells.length, 4);
const uiCases = [];
for (const cell of cells) {
  const args = [`--project=${cell.project}`, `--shard=${cell.shard}`, '--fully-parallel', `--workers=${cell.workers}`];
  const cases = list(cell.suite, args);
  console.log(`${cell.id}: ${cases.length} cases (${cell.workers} workers)`);
  uiCases.push(...cases);
}
exactlyOnce('UI', [...list('v2'), ...list('webkit')], uiCases);

const voice = job('frontend-voice');
const projects = voice.match(/^        project: \[([^\]]+)\]/m)?.[1].split(',').map((s) => s.trim());
assert.deepEqual(projects, ['chromium', 'firefox']);
assert(voice.includes('--project="$PROJECT" --workers=1'));
exactlyOnce('Voice', list('voice'), projects.flatMap((project) => list('voice', [`--project=${project}`, '--workers=1'])));
