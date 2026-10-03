/**
 * Which app the page belongs to: StintView or the alternative "Backseat Racer" (same code, own
 * name, logo and colours). The desktop app passes it as ?brand= (electron/renderer.cjs);
 * browser pages (OpenKneeboard, dev) are StintView.
 */
export type BrandId = 'stintview' | 'backseat';

export const brand: BrandId = new URLSearchParams(location.search).get('brand') === 'backseat' ? 'backseat' : 'stintview';
export const brandName = brand === 'backseat' ? 'Backseat Racer' : 'StintView';

/**
 * Texts written for StintView, in the alternative app's name. Installer and data folder are
 * the alternative app's own (BackseatRacer-Setup.exe, %APPDATA%\Backseat Racer). Same rules as electron/brand.cjs and the website.
 */
export function brandText(text: string): string {
  if (brand === 'stintview') return text;
  return text
    .replace(/StintView-Setup\.exe/g, 'BackseatRacer-Setup.exe')
    .replace(/%APPDATA%\\StintView/g, '%APPDATA%\\Backseat Racer')
    .replace(/(?<![\\/\w])StintViews(?!\w)/g, 'Backseat-Racer-Apps')
    .replace(/(?<![\\/\w])StintView-(?!Setup)/g, 'Backseat-Racer-')
    .replace(/(?<![\\/\w])StintView(?![-\w]|\.\w)/g, 'Backseat Racer');
}
