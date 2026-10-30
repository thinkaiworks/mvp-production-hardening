// Production-readiness checks for AI-built web apps (Lovable, Bolt, v0, Replit, Claude Code, Cursor).
// Each check gets the project snapshot and returns findings:
//   { id, severity: 'critical'|'high'|'medium'|'low', title, file?, line?, fix }

const SECRET_PATTERNS = [
  ['stripe-live-secret', /\bsk_live_[0-9a-zA-Z]{16,}/, 'Stripe live secret key'],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'OpenAI API key'],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key'],
  ['twilio-auth', /\bTWILIO_AUTH_TOKEN\s*[=:]\s*['"]?[a-f0-9]{32}/, 'Twilio auth token'],
];

const FRONTEND_DIR = /(^|\/)(src|app|pages|components|client|public|lib)\//;
const SERVER_HINT = /(^|\/)(api|server|functions|supabase\/functions|route\.(t|j)sx?$|actions?\.(t|j)s$)/;

const FRONTEND_FRAMEWORKS = /^(react|react-dom|next|vue|nuxt|svelte|@sveltejs\/kit|vite|@angular\/core|solid-js|astro|preact|expo|react-native)$/;

/** True when package.json declares a browser framework, so src/app/lib files end up in a client bundle. */
function hasFrontend(p) {
  if (p._hasFrontend !== undefined) return p._hasFrontend;
  const pkg = p.files.find((f) => f.path === 'package.json');
  let deps = {};
  try { const j = JSON.parse(pkg?.content || '{}'); deps = { ...j.dependencies, ...j.devDependencies }; } catch { /* reported elsewhere */ }
  p._hasFrontend = Object.keys(deps).some((d) => FRONTEND_FRAMEWORKS.test(d));
  return p._hasFrontend;
}

function isFrontendFile(f, p) {
  if (!/\.(jsx?|tsx?|vue|svelte)$/.test(f.path)) return false;
  const head = f.content.slice(0, 300);
  if (/['"]use server['"]|import\s+['"]server-only['"]/.test(head)) return false;
  if (/['"]use client['"]/.test(head) || /(^|\/)(public|client)\//.test(f.path)) return true;
  return hasFrontend(p) && FRONTEND_DIR.test(f.path) && !SERVER_HINT.test(f.path);
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function decodeJwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload.role;
  } catch {
    return null;
  }
}

export const checks = [
  function hardcodedSecrets(p) {
    const out = [];
    for (const f of p.files) {
      if (/\.env\.example$|\.md$/.test(f.path)) continue;
      for (const [id, re, name] of SECRET_PATTERNS) {
        const m = re.exec(f.content);
        if (m) out.push({ id: `secret:${id}`, severity: 'critical', title: `${name} committed in code`, file: f.path, line: lineOf(f.content, m.index), fix: 'Revoke and rotate this key now, move it to an environment variable on the server, and purge it from git history.' });
      }
      for (const m of f.content.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
        if (decodeJwtRole(m[0]) === 'service_role') {
          out.push({ id: 'secret:supabase-service-role', severity: 'critical', title: 'Supabase service_role key in the codebase (bypasses all RLS)', file: f.path, line: lineOf(f.content, m.index), fix: 'Rotate the service role key in Supabase settings. Only use it in server code via an env var, never in the browser.' });
        }
      }
    }
    return out;
  },

  function serviceRoleInFrontend(p) {
    return p.files.filter((f) => isFrontendFile(f, p)).flatMap((f) => {
      const m = /(SERVICE_ROLE|service_role|SUPABASE_SECRET)/.exec(f.content);
      return m ? [{ id: 'supabase:service-role-frontend', severity: 'critical', title: 'Service role / secret key referenced in frontend code', file: f.path, line: lineOf(f.content, m.index), fix: 'Use the anon key in the browser. Move privileged operations into an API route, server action or Supabase Edge Function.' }] : [];
    });
  },

  function publicEnvSecrets(p) {
    const out = [];
    for (const f of p.files) {
      for (const m of f.content.matchAll(/\b(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_)([A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|OPENAI|ANTHROPIC|STRIPE_SK|SK_LIVE)[A-Z0-9_]*)/g)) {
        out.push({ id: 'env:public-secret', severity: 'critical', title: `${m[1]}${m[2]} is bundled into the browser`, file: f.path, line: lineOf(f.content, m.index), fix: `Variables starting with ${m[1]} are shipped to every visitor. Rename it without the prefix and call the API from the server.` });
      }
    }
    return dedupe(out);
  },

  function envFileCommitted(p) {
    const envs = p.files.filter((f) => /(^|\/)\.env(\.local|\.production|\.development)?$/.test(f.path));
    const gi = p.files.find((f) => f.path === '.gitignore')?.content || '';
    const out = envs.map((f) => ({ id: 'env:committed', severity: 'critical', title: `${f.path} is in the repository`, file: f.path, fix: 'Delete it from git (git rm --cached), add it to .gitignore, rotate every key it contained.' }));
    if (!/^\.env/m.test(gi)) out.push({ id: 'env:not-ignored', severity: 'high', title: '.env files are not in .gitignore', file: '.gitignore', fix: 'Add `.env*` and `!.env.example` to .gitignore.' });
    return out;
  },

  function supabaseRls(p) {
    const out = [];
    const sql = p.files.filter((f) => f.path.endsWith('.sql'));
    const all = sql.map((f) => f.content).join('\n').toLowerCase();
    for (const f of sql) {
      for (const m of f.content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        const table = m[1].toLowerCase();
        const rls = new RegExp(`alter\\s+table\\s+(?:public\\.)?"?${table}"?\\s+enable\\s+row\\s+level\\s+security`);
        if (!rls.test(all)) out.push({ id: 'supabase:rls-off', severity: 'critical', title: `Table "${table}" has no Row Level Security`, file: f.path, line: lineOf(f.content, m.index), fix: `Anyone with your anon key can read/write every row. Add: alter table public.${table} enable row level security; then policies scoped to auth.uid().` });
      }
      for (const m of f.content.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (/using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/i.test(m[0]) && !/for\s+select/i.test(m[0])) {
          out.push({ id: 'supabase:open-policy', severity: 'high', title: 'Policy allows writes for everyone: using (true)', file: f.path, line: lineOf(f.content, m.index), fix: 'Scope the policy, e.g. using (auth.uid() = user_id) with check (auth.uid() = user_id).' });
        }
      }
    }
    return out;
  },

  function stripeWebhook(p) {
    return p.files
      .filter((f) => /webhook/i.test(f.path) && /stripe/i.test(f.content) && /\.(t|j)sx?$/.test(f.path))
      .filter((f) => !/constructEvent(Async)?\s*\(/.test(f.content))
      .map((f) => ({ id: 'stripe:unverified-webhook', severity: 'critical', title: 'Stripe webhook does not verify the signature', file: f.path, fix: 'Use stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET). Without it anyone can POST a fake "payment succeeded" event.' }));
  },

  function apiRoutesWithoutAuth(p) {
    return p.files
      .filter((f) => /(app\/api\/.+\/route|pages\/api\/.+|supabase\/functions\/.+\/index)\.(t|j)sx?$/.test(f.path) && !/webhook|health|public|auth\/callback/i.test(f.path))
      .filter((f) => /\b(POST|PUT|PATCH|DELETE)\b|req\.method/.test(f.content))
      .filter((f) => !/getUser\(|getSession\(|auth\(\)|currentUser|verifyToken|jwt|authorization|requireUser|getServerSession|clerk/i.test(f.content))
      .map((f) => ({ id: 'api:no-auth', severity: 'high', title: 'API route changes data without checking who the user is', file: f.path, fix: 'Get the user server-side (e.g. supabase.auth.getUser()) and return 401 if missing before doing any work.' }));
  },

  function aiCallsFromBrowser(p) {
    return p.files.filter((f) => isFrontendFile(f, p)).flatMap((f) => {
      const m = /api\.openai\.com|api\.anthropic\.com|dangerouslyAllowBrowser/.exec(f.content);
      return m ? [{ id: 'ai:browser-call', severity: 'high', title: 'AI provider called directly from the browser', file: f.path, line: lineOf(f.content, m.index), fix: 'Your API key is exposed and anyone can run up your bill. Proxy the call through an authenticated API route with per-user rate limits.' }] : [];
    });
  },

  function noRateLimit(p) {
    const hasAi = p.files.some((f) => /openai|anthropic|generateText|chat\.completions|messages\.create/i.test(f.content) && SERVER_HINT.test(f.path));
    const hasLimit = p.files.some((f) => /rate.?limit|upstash|limiter|quota|usage.?(check|limit|count)|monthly.?(limit|generations|credits)|credits.?remaining/i.test(f.content));
    return hasAi && !hasLimit ? [{ id: 'ai:no-rate-limit', severity: 'medium', title: 'AI endpoints have no rate limit or usage quota', fix: 'Add per-user quotas (count generations per month in the database) or a limiter such as @upstash/ratelimit.' }] : [];
  },

  function securityHeaders(p) {
    const has = p.files.some((f) => /(next\.config\.(m?js|ts)|vercel\.json|netlify\.toml|_headers|middleware\.(t|j)s)$/.test(f.path) && /Content-Security-Policy|X-Frame-Options|Strict-Transport-Security|helmet/i.test(f.content));
    return has ? [] : [{ id: 'headers:missing', severity: 'medium', title: 'No security headers configured', fix: 'Add X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security (see templates/security-headers).' }];
  },

  function looseDependencies(p) {
    const pkg = p.files.find((f) => f.path === 'package.json');
    if (!pkg) return [];
    let json;
    try { json = JSON.parse(pkg.content); } catch { return [{ id: 'deps:invalid-package-json', severity: 'high', title: 'package.json is not valid JSON', file: 'package.json', fix: 'Fix the JSON syntax.' }]; }
    const deps = { ...json.dependencies, ...json.devDependencies };
    const loose = Object.entries(deps).filter(([, v]) => v === '*' || v === 'latest' || v === '');
    const out = loose.map(([k, v]) => ({ id: 'deps:unpinned', severity: 'medium', title: `Dependency "${k}" is "${v || 'empty'}"`, file: 'package.json', fix: 'Pin to a version range (e.g. ^1.2.3) so a surprise major release cannot break production.' }));
    const lock = p.files.some((f) => /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(f.path));
    if (!lock && Object.keys(deps).length) out.push({ id: 'deps:no-lockfile', severity: 'medium', title: 'No lockfile committed', file: 'package.json', fix: 'Commit package-lock.json (or pnpm/yarn lock) so every deploy installs identical versions.' });
    return out;
  },

  function localhostUrls(p) {
    return dedupe(p.files.filter((f) => /\.(jsx?|tsx?)$/.test(f.path) && !/test|spec|\.config\.|playwright|vite\.config|jest/i.test(f.path)).flatMap((f) => {
      // Ignore `new URL(path, 'http://localhost')`, which only uses localhost as a parsing base.
      const m = [...f.content.matchAll(/['"`]https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g)]
        .find((x) => !/new URL\([^()]*,\s*$/.test(f.content.slice(Math.max(0, x.index - 80), x.index)));
      return m ? [{ id: 'config:localhost', severity: 'medium', title: 'Hard-coded localhost URL will break in production', file: f.path, line: lineOf(f.content, m.index), fix: 'Read the base URL from an environment variable.' }] : [];
    }));
  },

  function noTestsOrCi(p) {
    const out = [];
    if (!p.files.some((f) => /\.(test|spec)\.(t|j)sx?$|(^|\/)tests?\//.test(f.path))) out.push({ id: 'quality:no-tests', severity: 'low', title: 'No automated tests', fix: 'Add a few tests for the money paths (sign-up, checkout, core feature) to catch regressions from future AI edits.' });
    if (!p.files.some((f) => f.path.startsWith('.github/workflows/'))) out.push({ id: 'quality:no-ci', severity: 'low', title: 'No CI pipeline', fix: 'Copy templates/github-ci.yml to .github/workflows/ci.yml to lint, type-check, test and build on every push.' });
    return out;
  },

  function consoleLogs(p) {
    const count = p.files.filter((f) => /\.(jsx?|tsx?)$/.test(f.path) && !/test|spec/.test(f.path)).reduce((n, f) => n + (f.content.match(/console\.log\(/g) || []).length, 0);
    return count > 20 ? [{ id: 'quality:console-logs', severity: 'low', title: `${count} console.log calls left in the code`, fix: 'Remove debug logs (they can leak user data in the browser console) or use a logger that is silent in production.' }] : [];
  },

  function errorTracking(p) {
    const has = p.files.some((f) => /@sentry|sentry\.init|posthog|logrocket|highlight\.run|bugsnag/i.test(f.content));
    return has ? [] : [{ id: 'ops:no-error-tracking', severity: 'low', title: 'No error tracking', fix: 'Add Sentry (free tier) so you hear about crashes before customers email you.' }];
  },
];

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const k = `${f.id}|${f.file}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
