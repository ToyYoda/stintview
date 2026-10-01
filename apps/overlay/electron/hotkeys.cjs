// Overview of all global hotkeys for the setup window ("Tastaturkürzel"): which key each
// function actually got (first free one wins), which ones are free-able alternatives, and
// whether the function is active right now.

const { t } = require('./i18n.cjs');

/** "Control+Shift+PageUp" -> "Strg+Umschalt+Bild↑" (German) / "Ctrl+Shift+PgUp" (English). */
function displayKey(h) {
  if (!h) return null;
  const arrows = { Left: '←', Right: '→', Up: '↑', Down: '↓' };
  return h.split('+').map((k) => arrows[k] ?? (t(`key.${k}`) === `key.${k}` ? k : t(`key.${k}`))).join('+');
}

/**
 * @param {{ key: string | null, candidates: string[] }} edit       overlay edit toggle
 * @param {{ incident: string | null, back: string | null }} camera  registered camera keys (raw)
 * @param {{ keys: { key: string, label: string, ok: boolean }[], running: boolean }} vr
 * @param {{ overlay: boolean }} active
 */
function hotkeyGroups(edit, camera, cameraCandidates, vr, active) {
  // Candidates before the registered key are held by other programs, later ones are spares.
  const item = (label, key, candidates, on) => {
    const at = key ? candidates.indexOf(key) : -1;
    return {
      label,
      key: displayKey(key),
      // No key at all: every candidate is held by another program.
      taken: (key ? candidates.slice(0, Math.max(0, at)) : candidates).map(displayKey),
      alternatives: key ? candidates.slice(at + 1).map(displayKey) : [],
      active: on && Boolean(key),
    };
  };
  return [
    {
      title: t('keys.overlay'),
      note: active.overlay ? null : t('keys.overlayNote'),
      items: [item(t('keys.move'), edit.key ?? (active.overlay ? null : edit.candidates[0]), edit.candidates, active.overlay)],
    },
    {
      title: t('keys.camera'),
      note: null,
      items: [
        item(t('keys.incident'), camera.incident, cameraCandidates.incident, true),
        item(t('keys.back'), camera.back, cameraCandidates.back, true),
      ],
    },
    {
      title: t('keys.vr'),
      note: vr.running ? null : t('keys.vrNote'),
      items: vr.keys.map((k) => ({ label: k.label, key: k.ok ? displayKey(k.key) : null, taken: k.ok ? [] : [displayKey(k.key)], alternatives: [], active: vr.running && k.ok })),
    },
  ];
}

module.exports = { displayKey, hotkeyGroups };
