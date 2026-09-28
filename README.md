# StintView

Live-Telemetrie des aktuell fahrenden Teammitglieds als Overlay über iRacing – für Endurance-Teams.
Konzept und Hintergründe: [docs/konzept.md](docs/konzept.md).

```
Fahrer-PC ── Recorder ──wss──▶ Relay-Server ──wss──▶ Overlay (alle Teammitglieder)
```

| Teil | Pfad | Aufgabe |
|---|---|---|
| Recorder | `apps/recorder` | liest iRacing-Telemetrie, sendet nur, wenn der eigene Nutzer im Auto sitzt |
| Relay | `apps/server` | Team-Räume, Einladungscodes, genau eine aktive Quelle pro Team |
| Overlay | `apps/overlay` | Widgets Eingaben / Sprit / Reifen; Electron (Desktop), SteamVR-Panels oder Browser |
| Protokoll | `packages/protocol` | Nachrichtentypen (MessagePack) |
| Logik | `packages/telemetry` | Sprit pro Runde, Reifenmessungen, Verschleißprognose, Input-Downsampling |

## Einrichten

Voraussetzungen: Node 22, pnpm 9.

```bash
pnpm install
```

**Server starten** (lokal zum Testen; im Team auf einem erreichbaren Host, z. B. Fly.io/Hetzner):

```bash
pnpm relay
```

Port `8787` (Umgebungsvariable `PORT`), Teams werden in `%APPDATA%\StintView\server\teams.json` gespeichert (`STINTVIEW_DATA`).

**Team anlegen** (einmal, Teamchef):

```bash
pnpm recorder create-team --server http://localhost:8787 --team "Mein Team" --name "Philipp"
```

Gibt einen Einladungscode aus. **Teammitglieder treten bei:**

```bash
pnpm recorder join --server http://localhost:8787 --code ABCD-EFGH --name "Max"
```

Zugangsdaten landen in `%APPDATA%\StintView\config.json` (Recorder und Overlay nutzen dieselbe Datei). Mit iRacing-Konten hat das nichts zu tun.

## Benutzen

**Recorder** (auf jedem Fahrer-PC, läuft im Hintergrund):

```bash
pnpm recorder run
```

**Overlay** (Electron, durchsichtig über iRacing – iRacing im randlosen Fenstermodus):

```bash
pnpm overlay
```

`Strg+Umschalt+O` schaltet den Bearbeiten-Modus um (Widgets verschieben). Sonst gehen Klicks durch das Overlay.

**VR-Overlay** (SteamVR – z. B. Bigscreen Beyond; iRacing im OpenVR- oder OpenXR-Modus):

```bash
pnpm vr
```

Startet SteamVR nicht selbst, sondern wartet, bis es läuft. Jedes Widget wird ein eigenes Panel, standardmäßig ca. 80 cm vor der Sitzposition knapp unter Augenhöhe (Sitzposition in iRacing/SteamVR zurücksetzen, falls die Panels woanders schweben). Platzieren per Tastatur – funktioniert auch mit Brille:

| Taste | Wirkung |
|---|---|
| `Strg+Umschalt+V` | nächstes Panel auswählen (gelber Rahmen) |
| `Strg+Umschalt+Pfeile` | links/rechts/hoch/runter |
| `Strg+Umschalt+Bild↑/↓` | näher/weiter |
| `Strg+Umschalt+Plus/Minus` | größer/kleiner |
| `Strg+Umschalt+H` | alle ein-/ausblenden |

Positionen: `%APPDATA%\StintView\vr.json` (dort auch einzelne Panels mit `"enabled": false` abschalten).
Diagnose: `STINTVIEW_VR_STATS=1` (Uploads/s), `STINTVIEW_VR_DUMP=<ordner>` (Panels als PNG, geht ohne SteamVR), `STINTVIEW_VR_FPS=45`.

**Overlay im Browser** (Entwicklung, zweiter Monitor, OpenKneeboard):

```bash
pnpm overlay:web
```

Dann `http://127.0.0.1:5173/`. Einzelne Widgets: `#/widget/inputs`, `#/widget/fuel`, `#/widget/tyres`, `#/widget/header`.

## Ohne iRacing testen

Eine `.ibt`-Datei wie ein Live-Rennen abspielen:

```bash
pnpm recorder replay "D:\iRacing\telemetry\datei.ibt" --start 60 --speed 4 --loop
```

`--start` in Minuten ab Dateibeginn, `--speed` Zeitraffer. Zum Mitlesen ohne Overlay: `pnpm --filter @stintview/recorder exec tsx src/dev/listen.ts`.

## Tests

```bash
pnpm test
pnpm typecheck
```

## Bekannte Grenzen

- Reifen: iRacing liefert Karkasstemperatur und Verschleiß nur beim Stopp in der Box; Oberflächentemperatur und Druck gar nicht live. Das Widget zeigt die letzte Messung und schätzt den aktuellen Verschleiß aus den gefahrenen km.
- VR nur über SteamVR. Headsets ohne SteamVR (z. B. Quest per Link/Air Link): OpenKneeboard mit den Einzel-Widget-URLs.
- Recorder ist noch eine Konsolen-App (Tray-App und Autostart folgen).
