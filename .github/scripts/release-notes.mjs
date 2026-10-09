// Release notes from CHANGELOG.md (sections "## <version> – <date>").
//   node .github/scripts/release-notes.mjs 0.16.0   -> that version's notes on stdout (exit 1 if missing)
//   node .github/scripts/release-notes.mjs --list   -> all versions, one per line
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sections = new Map();
let current = null;
for (const line of text.split('\n')) {
  const head = /^## (\d+\.\d+\.\d+)\b/.exec(line);
  if (head) sections.set((current = head[1]), []);
  else if (line.startsWith('## ')) current = null;
  else if (current) sections.get(current).push(line);
}

const arg = (process.argv[2] ?? '').replace(/^v/, '');
if (arg === '--list') {
  console.log([...sections.keys()].join('\n'));
} else {
  const body = sections.get(arg)?.join('\n').trim();
  if (!body) {
    console.error(`CHANGELOG.md has no section "## ${arg} – …"`);
    process.exit(1);
  }
  console.log(body);
}
