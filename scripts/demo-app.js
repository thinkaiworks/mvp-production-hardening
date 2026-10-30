// Generates a typical AI-built MVP with the mistakes we see most often, into a temp folder.
// Fake secrets are assembled at runtime so no secret-looking string is ever committed to git.
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function makeDemoApp(dir = mkdtempSync(join(tmpdir(), 'demo-mvp-'))) {
  const serviceRoleJwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: 'supabase', ref: 'demo', role: 'service_role' }), 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.');
  const openaiKey = ['sk', 'proj', 'DEMO'.repeat(10)].join('-');

  const files = {
    'package.json': JSON.stringify({ name: 'my-saas', dependencies: { react: '^18.3.1', '@supabase/supabase-js': 'latest', stripe: '*' } }, null, 2),
    '.gitignore': 'node_modules\ndist\n',
    '.env': `VITE_SUPABASE_URL=https://demo.supabase.co\nVITE_OPENAI_API_KEY=${openaiKey}\n`,
    'src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js'\nexport const supabase = createClient('https://demo.supabase.co', '${serviceRoleJwt}')\n`,
    'src/pages/Generate.tsx': `export async function generate(prompt: string) {\n  const r = await fetch('https://api.openai.com/v1/chat/completions', { headers: { Authorization: 'Bearer ' + import.meta.env.VITE_OPENAI_API_KEY } })\n  console.log(r)\n}\n`,
    'src/config.ts': `export const API_URL = 'http://localhost:3000'\n`,
    'supabase/migrations/001_init.sql': `create table public.profiles (id uuid primary key, email text, plan text);\ncreate table public.projects (id uuid primary key, user_id uuid, name text);\nalter table public.projects enable row level security;\ncreate policy "anyone" on public.projects for all using (true) with check (true);\n`,
    'api/stripe-webhook.ts': `import Stripe from 'stripe'\nexport default async function handler(req, res) {\n  const event = req.body // trusts whatever is posted\n  if (event.type === 'checkout.session.completed') { /* upgrade user */ }\n  res.json({ ok: true })\n}\n`,
    'app/api/projects/route.ts': `export async function POST(req: Request) {\n  const body = await req.json()\n  // inserts without checking the user\n  return Response.json(body)\n}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  console.log(makeDemoApp());
}
