// Builds the static download site into ../_site:
//   index.html (template + ANLEITUNG.md rendered), assets/, stintview.zip (git archive of HEAD).
// Usage: node site/build.mjs [--no-zip]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, '_site');
const REPO = 'https://github.com/ToyYoda/stintview';

const slug = (s) =>
  s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const toc = [];
const marked = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      const id = slug(html);
      if (depth === 2) toc.push({ id, html });
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
    },
    code({ text }) {
      return `<div class="code"><pre><code>${escapeHtml(text)}</code></pre>` +
        `<button type="button" class="copy" aria-label="Befehl kopieren">Kopieren</button></div>\n`;
    },
    link({ href, tokens }) {
      const external = /^https?:/.test(href);
      return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

// The page has its own title and introduction: drop the guide's H1 and intro up to the first rule.
const guideMd = readFileSync(join(root, 'ANLEITUNG.md'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^# [^\n]*\n[\s\S]*?\n---\n/, '');
const guide = marked.parse(guideMd)
  .replace(/<table>/g, '<div class="table-wrap"><table>')
  .replace(/<\/table>/g, '</table></div>');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const version = `${git('log', '-1', '--format=%cd', '--date=format:%d.%m.%Y')} · ${git('rev-parse', '--short', 'HEAD')}`;

// Empty the folder rather than removing it (a local preview server may be serving it).
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(out)) rmSync(join(out, entry), { recursive: true, force: true });
cpSync(join(here, 'assets'), join(out, 'assets'), { recursive: true });

let zipSize = '';
if (!process.argv.includes('--no-zip')) {
  const zip = join(out, 'stintview.zip');
  git('archive', '-o', zip, 'HEAD');
  zipSize = `${Math.round(statSync(zip).size / 1024)} KB`;
}

const html = readFileSync(join(here, 'template.html'), 'utf8')
  .replaceAll('{{TOC}}', toc.map((t) => `<li><a href="#${t.id}">${t.html}</a></li>`).join('\n'))
  .replaceAll('{{GUIDE}}', guide)
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{ZIP_SIZE}}', zipSize ? ` · ${zipSize}` : '')
  .replaceAll('{{REPO}}', REPO);
writeFileSync(join(out, 'index.html'), html);
console.log(`site built: ${out} (${version}${zipSize ? `, zip ${zipSize}` : ''})`);
