// Builds the static download site into ../_site, one page per language:
//   _site/index.html (de), _site/en/index.html (en) and shared assets/.
// Experimental "Backseat Racer" design (new name, not linked from the main page, noindex):
//   _site/beta/index.html (de), _site/beta/en/index.html (en), template site/beta/template.html,
//   self-hosted fonts from @fontsource in _site/beta/fonts/.
// Downloads point at the installer of the latest GitHub release.
// Page texts: site/strings.mjs. Guides: ANLEITUNG.md (de), INSTALL.md (en).
// Usage: node site/build.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { BETA_STRINGS, LANGUAGES, STRINGS, renameApp } from './strings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, '_site');
const REPO = 'https://github.com/ToyYoda/stintview';
const SITE = 'https://toyyoda.github.io/stintview/';
const DOWNLOAD_URL = `${REPO}/releases/latest/download/StintView-Setup.exe`;
// Alternative app "Backseat Racer": own installer in the same release (electron-builder.backseat.yml).
const BETA_DOWNLOAD_URL = `${REPO}/releases/latest/download/BackseatRacer-Setup.exe`;

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


// Fonts of the experimental design (SIL Open Font License), served from the site itself.
const BETA_FONTS = [
  ['barlow-condensed', ['600-italic', '800-italic', '900-italic']],
  ['space-grotesk', ['400-normal', '500-normal', '700-normal']],
  ['jetbrains-mono', ['500-normal', '700-normal']],
];
mkdirSync(join(out, 'beta', 'fonts'), { recursive: true });
for (const [family, styles] of BETA_FONTS) {
  for (const st of styles) {
    const file = `${family}-latin-${st}.woff2`;
    cpSync(join(here, 'node_modules', '@fontsource', family, 'files', file), join(out, 'beta', 'fonts', file));
  }
}

const langs = Object.keys(LANGUAGES);
const VARIANTS = [
  { name: 'main', dir: '', template: 'template.html' },
  { name: 'beta', dir: 'beta', template: join('beta', 'template.html'), rename: true, download: BETA_DOWNLOAD_URL },
];

const built = [];
for (const variant of VARIANTS) {
const template = readFileSync(join(here, variant.template), 'utf8');
const pageUrl = (lang) => SITE + (variant.dir ? `${variant.dir}/` : '') + (LANGUAGES[lang].dir ? `${LANGUAGES[lang].dir}/` : '');
for (const lang of langs) {
  const { dir: langDir, guide, dateFormat } = LANGUAGES[lang];
  const dir = join(variant.dir, langDir);
  // Experimental design: the app is called "Backseat Racer" there (texts and guide).
  const t = variant.rename
    ? { ...Object.fromEntries(Object.entries(STRINGS[lang]).map(([k, v]) => [k, renameApp(v)])), ...BETA_STRINGS[lang] }
    : STRINGS[lang];
  const base = '../'.repeat(dir.split(/[\\/]/).filter((p) => p && p !== '.').length);
  const rendered = renderGuide(guide, t);
  const html = variant.rename ? renameApp(rendered.html) : rendered.html;
  const toc = variant.rename ? renameApp(rendered.toc) : rendered.toc;

  const altLinks = [
    ...langs.map((l) => `  <link rel="alternate" hreflang="${l}" href="${pageUrl(l)}">`),
    `  <link rel="alternate" hreflang="x-default" href="${pageUrl(langs[0])}">`,
  ].join('\n');
  // Relative links so the pages also work from a local preview.
  // Language switch within the same variant.
  const variantBase = langDir ? '../' : '';
  const switcher = `<span class="lang" role="group" aria-label="${t.langLabel}">` + langs.map((l) => {
    const target = l === lang ? './' : LANGUAGES[l].dir ? `${variantBase}${LANGUAGES[l].dir}/` : (variantBase || './');
    const current = l === lang ? ' aria-current="page"' : '';
    return `<a href="${target}" hreflang="${l}" lang="${l}"${current}>${l.toUpperCase()}</a>`;
  }).join('') + '</span>';

  const values = {
    ...t,
    LANG: lang,
    BASE: base,
    // Screenshots of the app in the page language (German ones in assets/, English in assets/en/).
    SHOTS: `${base}assets/${lang === 'de' ? '' : `${lang}/`}`,
    ALT_LINKS: altLinks,
    LANG_SWITCH: switcher,
    TOC: toc,
    GUIDE: html,
    VERSION: `${git('log', '-1', `--format=%cd`, `--date=format:${dateFormat}`)} · ${sha}`,
    DOWNLOAD_URL: variant.download ?? DOWNLOAD_URL,
    REPO,
    // Beta only: the main page in the same language, and the self-hosted fonts.
    MAIN: `${base}${langDir ? `${langDir}/` : ''}`,
    FONTS: `${base}beta/fonts/`,
  };
  const page = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value for "${lang}"`);
    return values[key];
  });

  const target = join(out, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'index.html'), page);
  built.push({ page, target, lang });
  console.log(`built ${variant.name} ${lang}: ${join(target, 'index.html')}`);
}
}
// Check only once every page exists, since the pages link to each other.
for (const { page, target, lang } of built) checkLocalRefs(page, target, lang);

/** Fails the build if a page references a local file that doesn't exist (e.g. a wrong relative path). */
function checkLocalRefs(page, pageDir, lang) {
  const refs = [...page.matchAll(/(?:src|href)="([^"]+)"|url\("([^"]+)"\)/g)].map((m) => m[1] ?? m[2]);
  const missing = refs.filter((ref) => {
    if (/^(#|https?:|data:|mailto:)/.test(ref)) return false;
    const path = join(pageDir, ref.split('#')[0]);
    try {
      return !statSync(ref.endsWith('/') ? join(path, 'index.html') : path).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length) throw new Error(`${lang}: broken local references: ${[...new Set(missing)].join(', ')}`);
}
console.log(`site built (${sha})`);
