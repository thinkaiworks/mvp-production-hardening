#!/usr/bin/env node
// Usage: npx launch-check <project-dir> [--md report.md] [--json] [--fail-on critical|high|medium]
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadProject, scan, toMarkdown } from '../lib/scan.js';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--md', '--fail-on']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const dir = resolve(positional[0] || '.');
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const failOn = flag('--fail-on') || 'critical';

const result = scan(loadProject(dir));

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const md = toMarkdown(result, basename(dir));
  console.log(md);
  const out = flag('--md');
  if (out) writeFileSync(out, md);
}

const levels = ['critical', 'high', 'medium', 'low'];
const blocking = levels.slice(0, levels.indexOf(failOn) + 1).some((s) => result.counts[s] > 0);
process.exit(blocking ? 1 : 0);
