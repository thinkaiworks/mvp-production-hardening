# MVP Production Hardening (`launch-check`)

**You built your MVP with Lovable, Bolt, v0, Replit, Cursor or Claude Code. Before real users and real payments hit it, find out what will get you hacked, billed or embarrassed.** One command scans the codebase and gives you a launch-readiness score, every problem with the file and line, and the exact fix.

Built by [ThinkAIWorks](https://thinkaiworks.com).

## What it catches

| | Issue | Why it matters |
|---|---|---|
| 🔴 | API keys committed (OpenAI, Anthropic, Stripe live, AWS, GitHub, private keys) | Bots scrape GitHub for keys within minutes |
| 🔴 | **Supabase `service_role` key** in code or in the browser | Bypasses every security rule: full read/write to your database |
| 🔴 | Secrets in `VITE_` / `NEXT_PUBLIC_` / `REACT_APP_` variables | These are shipped to every visitor's browser |
| 🔴 | `.env` committed to the repo | Every key inside is public |
| 🔴 | **Supabase tables without Row Level Security** | Anyone with your public anon key can read or delete all rows |
| 🔴 | Stripe webhook without signature verification | Anyone can fake a "payment succeeded" and get a free upgrade |
| 🟠 | Policies like `using (true)` on writes | RLS is on, but lets everyone write |
| 🟠 | API routes that change data without checking the user | Unauthenticated writes |
| 🟠 | OpenAI / Claude called straight from the browser | Your key leaks and anyone can run up your AI bill |
| 🟡 | No rate limit / quota on AI endpoints | One user (or bot) can cost you hundreds overnight |
| 🟡 | No security headers, `"latest"`/`"*"` dependency versions, no lockfile, hard-coded `localhost` URLs | Clickjacking, surprise breakages, broken production builds |
| ⚪ | No tests, no CI, no error tracking, leftover `console.log`s | You hear about bugs from customers |

## Try it

```bash
npm run demo        # generates a typical AI-built app with common mistakes and scans it
```

```
# Launch readiness: demo AI-built MVP
**Score: 0/100 · NOT SAFE TO LAUNCH**

| 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low |
| 7 | 4 | 5 | 3 |

## 🔴 Critical
- Supabase service_role key in the codebase (bypasses all RLS) — src/lib/supabase.ts:2
  - Fix: Rotate the service role key in Supabase settings. Only use it in server code...
- Table "profiles" has no Row Level Security — supabase/migrations/001_init.sql:1
- Stripe webhook does not verify the signature — api/stripe-webhook.ts
...
```

## Scan your project

```bash
node bin/launch-check.js /path/to/your-app
node bin/launch-check.js /path/to/your-app --md launch-report.md   # save a shareable report
node bin/launch-check.js /path/to/your-app --json                  # for tooling
```

Exit code is `1` when issues at or above `--fail-on` (default `critical`) exist, so you can block deploys in CI.

No install needed. Plain Node.js 20+, zero dependencies, nothing leaves your machine.

## Fix kit (`templates/`)

| File | Use it for |
|---|---|
| `supabase-rls.sql` | Copy-paste RLS policies: per-user rows, multi-tenant orgs, public-read/owner-write |
| `stripe-webhook.ts` | A verified Next.js Stripe webhook handler |
| `security-headers/` | Headers for Next.js, Vercel, Netlify and Cloudflare Pages |
| `github-ci.yml` | CI that lints, type-checks, tests, builds and runs launch-check on every push |

## The production-hardening checklist we run

1. Run `launch-check` and fix every 🔴 and 🟠.
2. Rotate any key that was ever committed, then purge it from git history.
3. Turn on RLS for every table; test policies while logged in as two different users.
4. Move AI calls server-side with per-user quotas.
5. Verify the Stripe webhook, and make it idempotent.
6. Add CI, error tracking (Sentry) and uptime monitoring.
7. Re-run `launch-check` until it says **READY TO LAUNCH**.

## Tests

```bash
npm test
```

## Stack

Node.js (zero dependencies) · Supabase · Stripe · Next.js / Vite · GitHub Actions
