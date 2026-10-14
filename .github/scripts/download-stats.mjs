// Download counts of the release files, summed over all releases, as one row per day in
// docs/downloads.csv (GitHub only keeps the current totals, so the history has to be recorded).
// Run daily by .github/workflows/download-stats.yml; locally: node .github/scripts/download-stats.mjs
//
// Columns: StintView-Setup.exe also counts auto-updates; the updater fetches the .blockmap first,
// so `installs_est` = exe − blockmap estimates new installs. latest.yml = update checks
// (every running app at start and hourly), a rough measure of how many apps run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'ToyYoda/stintview';
const FILE = new URL('../../docs/downloads.csv', import.meta.url);
const COLUMNS = ['date', 'installs_est', 'setup_exe', 'setup_blockmap', 'latest_yml', 'backseat_exe', 'backseat_blockmap', 'backseat_yml', 'newest_release', 'newest_setup_exe'];

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'stintview-download-stats' };
if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;

const releases = [];
for (let page = 1; ; page++) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const batch = await res.json();
  releases.push(...batch);
  if (batch.length < 100) break;
}

const total = (name) => releases.reduce((n, r) => n + (r.assets.find((a) => a.name === name)?.download_count ?? 0), 0);
const published = releases.filter((r) => !r.draft && !r.prerelease)
  .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
const newest = published[0];

const row = {
  date: new Date().toISOString().slice(0, 10),
  setup_exe: total('StintView-Setup.exe'),
  setup_blockmap: total('StintView-Setup.exe.blockmap'),
  latest_yml: total('latest.yml'),
  backseat_exe: total('BackseatRacer-Setup.exe'),
  backseat_blockmap: total('BackseatRacer-Setup.exe.blockmap'),
  backseat_yml: total('backseat.yml'),
  newest_release: newest?.tag_name ?? '',
  newest_setup_exe: newest?.assets.find((a) => a.name === 'StintView-Setup.exe')?.download_count ?? 0,
};
row.installs_est = Math.max(0, row.setup_exe - row.setup_blockmap);

// A second run on the same day replaces that day's row.
const lines = existsSync(FILE) ? readFileSync(FILE, 'utf8').trim().split('\n').slice(1) : [];
const kept = lines.filter((l) => l && !l.startsWith(`${row.date},`));
kept.push(COLUMNS.map((c) => row[c]).join(','));
writeFileSync(FILE, `${COLUMNS.join(',')}\n${kept.join('\n')}\n`);
console.log(COLUMNS.map((c) => `${c}=${row[c]}`).join(' '));
