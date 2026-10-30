import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDemoApp } from '../scripts/demo-app.js';
import { loadProject, scan, toMarkdown } from '../lib/scan.js';

const ids = (r) => new Set(r.findings.map((f) => f.id));

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

test('demo app: catches the classic AI-built MVP mistakes', () => {
  const r = scan(loadProject(makeDemoApp()));
  const found = ids(r);
  for (const id of [
    'secret:supabase-service-role', 'secret:openai-key', 'env:public-secret', 'env:committed', 'env:not-ignored',
    'supabase:rls-off', 'supabase:open-policy', 'stripe:unverified-webhook', 'api:no-auth', 'ai:browser-call',
    'deps:unpinned', 'deps:no-lockfile', 'config:localhost', 'quality:no-ci', 'headers:missing',
  ]) assert.ok(found.has(id), `expected ${id}`);
  assert.equal(r.verdict, 'NOT SAFE TO LAUNCH');
  assert.equal(r.score, 0);
  assert.equal(r.findings[0].severity, 'critical');
  const rls = r.findings.find((f) => f.id === 'supabase:rls-off');
  assert.match(rls.title, /profiles/);
});

test('a well-built project passes', () => {
  const dir = project({
    'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
    'package-lock.json': '{}',
    '.gitignore': '.env*\n!.env.example\nnode_modules\n',
    '.github/workflows/ci.yml': 'name: ci',
    'next.config.mjs': "headers: [{ key: 'X-Frame-Options', value: 'DENY' }]",
    'supabase/migrations/1.sql': 'create table public.notes (id uuid, user_id uuid);\nalter table public.notes enable row level security;\ncreate policy "own" on public.notes for all using (auth.uid() = user_id);',
    'app/api/notes/route.ts': 'export async function POST() { const { data: { user } } = await supabase.auth.getUser(); }',
    'app/api/stripe/webhook/route.ts': 'stripe.webhooks.constructEvent(body, sig, secret)',
    'lib/sentry.ts': "import * as Sentry from '@sentry/nextjs'",
    'tests/notes.test.ts': 'test()',
  });
  const r = scan(loadProject(dir));
  assert.deepEqual(r.findings, []);
  assert.equal(r.verdict, 'READY TO LAUNCH');
  assert.match(toMarkdown(r), /No issues found/);
});

test('backend-only projects: lib/ is server code, URL parse bases are fine, ignore file works', () => {
  const dir = project({
    'package.json': JSON.stringify({ name: 'api', dependencies: {} }),
    'lib/llm.js': "fetch('https://api.anthropic.com/v1/messages')",
    'server.js': "const url = new URL(req.url, 'http://localhost');",
    'fixtures/bad.js': "const k = 'sk-ant-" + 'x'.repeat(30) + "'",
    '.launchcheckignore': '# fixtures\nfixtures/\n',
  });
  const found = ids(scan(loadProject(dir)));
  for (const id of ['ai:browser-call', 'config:localhost', 'deps:no-lockfile', 'secret:anthropic-key']) assert.ok(!found.has(id), `unexpected ${id}`);

  const react = project({ 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }), 'lib/llm.js': "fetch('https://api.openai.com/v1/chat')" });
  assert.ok(ids(scan(loadProject(react))).has('ai:browser-call'));
});

test('select-only public policy is allowed', () => {
  const dir = project({ 'x.sql': 'create table posts (id int);\nalter table posts enable row level security;\ncreate policy "read" on posts for select using (true);' });
  assert.ok(!ids(scan(loadProject(dir))).has('supabase:open-policy'));
});

test('CLI exits 1 when critical issues exist and writes a report', () => {
  const dir = makeDemoApp();
  const out = join(dir, 'report.md');
  let code = 0;
  try {
    execFileSync('node', [new URL('../bin/launch-check.js', import.meta.url).pathname, dir, '--md', out], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1);
});
