// Builds the static download site into ../_site, one page per language:
//   _site/index.html (de), _site/en/index.html (en), shared assets/ and stintview.zip (git archive of HEAD).
// Page texts: site/strings.mjs. Guides: ANLEITUNG.md (de), INSTALL.md (en).
// Usage: node site/build.mjs [--no-zip]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { LANGUAGES, STRINGS } from './strings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, '_site');
const REPO = 'https://github.com/ToyYoda/stintview';
const SITE = 'https://toyyoda.github.io/stintview/';

const slug = (s) =>
  s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders a guide to HTML and collects its H2s for the table of contents. */
function renderGuide(file, t) {
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
          `<button type="button" class="copy" aria-label="${t.copyAria}">${t.copy}</button></div>\n`;
      },
      link({ href, tokens }) {
        const external = /^https?:/.test(href);
        return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  // The page has its own title and introduction: drop the guide's H1 and intro up to the first rule.
  const md = readFileSync(join(root, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^# [^\n]*\n[\s\S]*?\n---\n/, '');
  const html = marked.parse(md)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
  return { html, toc: toc.map((e) => `<li><a href="#${e.id}">${e.html}</a></li>`).join('\n') };
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = git('rev-parse', '--short', 'HEAD');

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

const template = readFileSync(join(here, 'template.html'), 'utf8');
const langs = Object.keys(LANGUAGES);
const pageUrl = (lang) => SITE + (LANGUAGES[lang].dir ? `${LANGUAGES[lang].dir}/` : '');

const built = [];
for (const lang of langs) {
  const { dir, guide, dateFormat } = LANGUAGES[lang];
  const t = STRINGS[lang];
  const base = dir ? '../' : '';
  const { html, toc } = renderGuide(guide, t);

  const altLinks = [
    ...langs.map((l) => `  <link rel="alternate" hreflang="${l}" href="${pageUrl(l)}">`),
    `  <link rel="alternate" hreflang="x-default" href="${pageUrl(langs[0])}">`,
  ].join('\n');
  // Relative links so the pages also work from a local preview.
  const switcher = `<span class="lang" role="group" aria-label="${t.langLabel}">` + langs.map((l) => {
    const target = l === lang ? './' : LANGUAGES[l].dir ? `${base}${LANGUAGES[l].dir}/` : (base || './');
    const current = l === lang ? ' aria-current="page"' : '';
    return `<a href="${target}" hreflang="${l}" lang="${l}"${current}>${l.toUpperCase()}</a>`;
  }).join('') + '</span>';

  const values = {
    ...t,
    LANG: lang,
    BASE: base,
    ALT_LINKS: altLinks,
    LANG_SWITCH: switcher,
    TOC: toc,
    GUIDE: html,
    VERSION: `${git('log', '-1', `--format=%cd`, `--date=format:${dateFormat}`)} · ${sha}`,
    ZIP_SIZE: zipSize ? ` · ${zipSize}` : '',
    REPO,
  };
  const page = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value for "${lang}"`);
    return values[key];
  });

  const target = join(out, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'index.html'), page);
  built.push({ page, target, lang });
  console.log(`built ${lang}: ${join(target, 'index.html')}`);
}
// Check only once every page exists, since the pages link to each other.
for (const { page, target, lang } of built) checkLocalRefs(page, target, lang);

/** Fails the build if a page references a local file that doesn't exist (e.g. a wrong relative path). */
function checkLocalRefs(page, pageDir, lang) {
  const refs = [...page.matchAll(/(?:src|href)="([^"]+)"|url\("([^"]+)"\)/g)].map((m) => m[1] ?? m[2]);
  const missing = refs.filter((ref) => {
    if (/^(#|https?:|data:|mailto:)/.test(ref)) return false;
    if (ref.endsWith('stintview.zip') && !zipSize) return false; // --no-zip
    const path = join(pageDir, ref.split('#')[0]);
    try {
      return !statSync(ref.endsWith('/') ? join(path, 'index.html') : path).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length) throw new Error(`${lang}: broken local references: ${[...new Set(missing)].join(', ')}`);
}
console.log(`site built (${sha}${zipSize ? `, zip ${zipSize}` : ''})`);
