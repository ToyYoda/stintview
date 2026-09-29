/**
 * iRacing's driver "flair" is a country name in English (DriverInfo.Drivers[].FlairName,
 * e.g. "Germany"), or "Global" / "-none-". Maps it to a lower-case ISO 3166 code as used by
 * the flag images ("de"; England/Scotland/Wales/Northern Ireland as "gb-eng" etc.).
 */
const ALIASES: Record<string, string> = {
  england: 'gb-eng',
  scotland: 'gb-sct',
  wales: 'gb-wls',
  'northern ireland': 'gb-nir',
  usa: 'us',
  'united states of america': 'us',
  'czech republic': 'cz',
  'russian federation': 'ru',
  'south korea': 'kr',
  'korea, republic of': 'kr',
  korea: 'kr',
  turkey: 'tr',
  macedonia: 'mk',
  holland: 'nl',
  'ivory coast': 'ci',
  'hong kong': 'hk',
  taiwan: 'tw',
  'great britain': 'gb',
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

/** Reserved or withdrawn codes ICU still names (UK = United Kingdom, DD = East Germany, …). */
const LEGACY = new Set(['UK', 'DD', 'FX', 'BU', 'TP', 'YU', 'ZR', 'CS', 'SU', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'AN']);

let byName: Map<string, string> | null = null;

function names(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  const display = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try { name = display.of(code); } catch { continue; }
      if (!name || name === code || LEGACY.has(code) || byName.has(norm(name))) continue;
      byName.set(norm(name), code.toLowerCase());
    }
  }
  return byName;
}

export function countryCode(flair: string | undefined | null): string | null {
  if (!flair) return null;
  const key = norm(flair);
  return ALIASES[key] ?? names().get(key) ?? null;
}
