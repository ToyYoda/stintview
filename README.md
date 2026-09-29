# StintView

Live-Telemetrie des aktuell fahrenden Teammitglieds als Overlay über iRacing – für Endurance-Teams.
Konzept und Hintergründe: [docs/konzept.md](docs/konzept.md). **Für Teammitglieder:** Installer und Anleitung auf <https://toyyoda.github.io/stintview/> ([ANLEITUNG.md](ANLEITUNG.md) / [INSTALL.md](INSTALL.md)).

```
Fahrer-PC ── Recorder ──ws──▶ Relay-Server ──ws──▶ Overlay (alle Teammitglieder)
```

| Teil | Pfad | Aufgabe |
|---|---|---|
| Desktop-App | `apps/overlay` | Electron-App (Tray, Einrichtung, Updates); startet Recorder und Relay als Hintergrundprozesse, zeigt das Overlay am Monitor und als SteamVR-Panels |
| Recorder | `apps/recorder` | liest iRacing-Telemetrie, sendet nur, wenn der eigene Nutzer im Auto sitzt; auch als Kommandozeilen-Tool |
| Relay | `apps/server` | Team-Räume, Einladungscodes, genau eine aktive Quelle pro Team |
| Protokoll | `packages/protocol` | Nachrichtentypen (MessagePack) |
| Logik | `packages/telemetry` | Sprit pro Runde, Reifenmessungen, Verschleißprognose, Input-Downsampling |
| Website | `site/` | Download-Seite (de/en), gebaut aus `ANLEITUNG.md` / `INSTALL.md` |

## Entwickeln

Voraussetzungen: Node 22, pnpm 9.

```bash
pnpm install
pnpm app            # Desktop-App mit Vite-Dev-Server (Recorder/Relay werden vorher gebündelt)
pnpm test
pnpm typecheck
```

Die App legt Zugangsdaten, Einstellungen, VR-Layout und Protokolle in `%APPDATA%\StintView` ab.
Für Tests ein getrenntes Profil verwenden: `STINTVIEW_HOME=<ordner>` leitet alles um.

Aufbau der App (`apps/overlay/electron/`):

| Datei | Aufgabe |
|---|---|
| `app.cjs` | Einstieg: Tray-Menü, Einrichtungsfenster (`#/setup`), Hintergrundprozesse, Autostart, Updates |
| `overlay-window.cjs` | durchsichtiges Monitor-Overlay; Verschieben per Knopf oder erstem freien Kürzel aus `Strg+Umschalt+O`, `Strg+Alt+O`, `Strg+Umschalt+F9` |
| `vr.cjs`, `openvr.cjs`, `d3d11.cjs` | SteamVR-Panels (OpenVR + D3D11-Texturen per koffi, kein nativer Build) |
| `config.cjs` | Zugangsdaten (`config.json`), Einstellungen (`app.json`), Beitreten/Anlegen |
| `camera.cjs` | Zuschauer-Kamera: Knöpfe/Kürzel „Zum Unfall“ (Strg+Umschalt+J) und „Zurück“ (Strg+Umschalt+K) → Recorder (`apps/recorder/src/spectator.ts`, iRacing-Broadcast `CamSwitchNum`) |

Recorder und Relay bündelt `scripts/bundle.mjs` mit esbuild nach `dist-bundles/`; die App startet sie als Electron-`utilityProcess`, Nutzer brauchen also kein Node.js.

### Installer

```bash
pnpm dist           # -> apps/overlay/release/StintView-Setup.exe (lokal, wird nicht veröffentlicht)
```

Veröffentlichen: Tag pushen, GitHub Actions baut auf Windows und legt ein Release an (`.github/workflows/release.yml`). Installierte Apps aktualisieren sich darüber selbst.

```bash
git tag v0.2.1
git push origin v0.2.1
```

Der Installer ist nicht signiert (SmartScreen-Warnung beim ersten Start).
Lokal unter Windows ohne Entwicklermodus scheitert electron-builder beim Entpacken von `winCodeSign` (macOS-Symlinks). Abhilfe: das Archiv aus `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` einmal mit `7za x … -xr!darwin` nach `winCodeSign-2.6.0` entpacken.

### Ohne iRacing testen

Eine `.ibt`-Datei wie ein Live-Rennen abspielen (Recorder als Kommandozeilen-Tool, nutzt dieselben Zugangsdaten):

```bash
pnpm recorder replay "D:\iRacing\telemetry\datei.ibt" --start 60 --speed 4 --loop
```

`--start` in Minuten ab Dateibeginn, `--speed` Zeitraffer. Weitere Befehle: `pnpm recorder --help` (u. a. `join`, `create-team`, `run`). Zum Mitlesen ohne Overlay: `pnpm --filter @stintview/recorder exec tsx src/dev/listen.ts`.

Relay allein starten: `pnpm relay` (Port `8787` bzw. `PORT`, Teams in `%APPDATA%\StintView\server\teams.json` bzw. `STINTVIEW_DATA`).

Overlay im Browser (zweiter Monitor, OpenKneeboard): `pnpm app:web`, dann `http://127.0.0.1:5173/`. Einzelne Widgets: `#/widget/inputs`, `#/widget/fuel`, `#/widget/tyres`, `#/widget/header`.

VR-Diagnose: `STINTVIEW_VR_DUMP=<ordner>` (Panels als PNG, geht ohne SteamVR), `STINTVIEW_VR_FPS=45`. Das Panel-Layout steht in `%APPDATA%\StintView\vr.json` (dort auch einzelne Panels mit `"enabled": false` abschalten).

App fernsteuern (Tests): mit `--remote-debugging-port=9333` starten, dann `node apps/overlay/scripts/cdp.mjs eval "<js>"`, `… drag "x1,y1,x2,y2"` bzw. `… shot bild.png` (optional mit Route, z. B. `"index.html#/"` fürs Overlay). Neben einer installierten StintView testen: `STINTVIEW_HOME=<ordner>` setzen, dann hat die Instanz ein eigenes Profil.

## Bekannte Grenzen

- Reifen: iRacing liefert Karkasstemperatur und Verschleiß nur beim Stopp in der Box; Oberflächentemperatur und Druck gar nicht live. Das Widget zeigt die letzte Messung und schätzt den aktuellen Verschleiß aus den gefahrenen km.
- VR nur über SteamVR. Headsets ohne SteamVR (z. B. Quest per Link/Air Link): OpenKneeboard mit den Einzel-Widget-URLs.
- Die App-Oberfläche ist nur auf Deutsch.
- Verbindung zum Relay ist unverschlüsselt (`ws://`).
