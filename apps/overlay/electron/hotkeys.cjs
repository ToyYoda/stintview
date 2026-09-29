// Overview of all global hotkeys for the setup window ("Tastaturkürzel"): which key each
// function actually got (first free one wins), which ones are free-able alternatives, and
// whether the function is active right now.

/** "Control+Shift+PageUp" -> "Strg+Umschalt+Bild↑" */
function displayKey(h) {
  if (!h) return null;
  const names = {
    Control: 'Strg', Shift: 'Umschalt', Alt: 'Alt', Left: '←', Right: '→', Up: '↑', Down: '↓',
    PageUp: 'Bild↑', PageDown: 'Bild↓', Plus: 'Plus', '-': 'Minus',
  };
  return h.split('+').map((k) => names[k] ?? k).join('+');
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
      title: 'Overlay am Monitor',
      note: active.overlay ? null : 'Nur aktiv, wenn „Overlay am Monitor“ eingeschaltet ist.',
      items: [item('Anzeigen verschieben an/aus', edit.key ?? (active.overlay ? null : edit.candidates[0]), edit.candidates, active.overlay)],
    },
    {
      title: 'Kamera (als Zuschauer in iRacing)',
      note: null,
      items: [
        item('Zum Unfall vor deinem Fahrer springen', camera.incident, cameraCandidates.incident, true),
        item('Zurück zu deinem Fahrer', camera.back, cameraCandidates.back, true),
      ],
    },
    {
      title: 'VR-Overlay (SteamVR)',
      note: vr.running ? null : 'Nur aktiv, wenn „VR-Overlay“ eingeschaltet ist.',
      items: vr.keys.map((k) => ({ label: k.label, key: k.ok ? displayKey(k.key) : null, taken: k.ok ? [] : [displayKey(k.key)], alternatives: [], active: vr.running && k.ok })),
    },
  ];
}

module.exports = { displayKey, hotkeyGroups };
