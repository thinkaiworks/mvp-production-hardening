// npm run demo — build a typical broken AI-built MVP and scan it.
import { makeDemoApp } from './demo-app.js';
import { loadProject, scan, toMarkdown } from '../lib/scan.js';

const dir = makeDemoApp();
console.log(toMarkdown(scan(loadProject(dir)), 'demo AI-built MVP'));
console.log(`\n(demo app generated at ${dir})`);
