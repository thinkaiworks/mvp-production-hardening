// Walk a project, run every check, compute a launch-readiness score, render a report.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checks } from './checks.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.vercel', '.turbo', 'coverage', '.venv', '__pycache__']);
const MAX_BYTES = 512 * 1024;
const TEXT = /\.(jsx?|tsx?|mjs|cjs|vue|svelte|json|sql|toml|ya?ml|md|html|css|env|example|local|production|development|lock)$|(^|\/)(\.env[^/]*|\.gitignore|_headers|Dockerfile)$/;

/** Paths listed in .launchcheckignore (one prefix per line, # for comments) are skipped, e.g. deliberate test fixtures. */
function readIgnore(root) {
  try {
    return readFileSync(join(root, '.launchcheckignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

export function loadProject(root) {
  const files = [];
  const ignore = readIgnore(root);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const path = relative(root, full).split('\\').join('/');
        if (ignore.some((prefix) => path === prefix || path.startsWith(prefix.replace(/\/?$/, '/')))) continue;
        if (st.size <= MAX_BYTES && TEXT.test(path)) files.push({ path, content: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(root);
  return { root, files };
}

const WEIGHT = { critical: 25, high: 10, medium: 4, low: 1 };
const ORDER = ['critical', 'high', 'medium', 'low'];

export function scan(project) {
  const findings = checks.flatMap((check) => check(project));
  findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const penalty = findings.reduce((n, f) => n + WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const counts = Object.fromEntries(ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const verdict = counts.critical ? 'NOT SAFE TO LAUNCH' : counts.high ? 'FIX BEFORE LAUNCH' : score >= 90 ? 'READY TO LAUNCH' : 'LAUNCHABLE WITH CLEANUP';
  return { score, verdict, counts, findings, filesScanned: project.files.length };
}

const ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };

export function toMarkdown(result, name = 'project') {
  const lines = [
    `# Launch readiness: ${name}`,
    '',
    `**Score: ${result.score}/100 · ${result.verdict}**`,
    '',
    `| 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low | Files scanned |`,
    `|---|---|---|---|---|`,
    `| ${result.counts.critical} | ${result.counts.high} | ${result.counts.medium} | ${result.counts.low} | ${result.filesScanned} |`,
    '',
  ];
  for (const sev of ORDER) {
    const group = result.findings.filter((f) => f.severity === sev);
    if (!group.length) continue;
    lines.push(`## ${ICON[sev]} ${sev[0].toUpperCase() + sev.slice(1)}`, '');
    for (const f of group) {
      const where = f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
      lines.push(`- **${f.title}**${where}`, `  - Fix: ${f.fix}`);
    }
    lines.push('');
  }
  if (!result.findings.length) lines.push('No issues found. 🎉');
  return lines.join('\n');
}
