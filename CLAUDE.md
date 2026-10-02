# StintView – Hinweise für Claude

**Zuerst lesen:** [docs/SPEC.md](docs/SPEC.md) – maßgebliche Spezifikation (Anforderungen A1–A16, Entscheidungen, Architektur, Protokoll, iRacing-/VR-Messergebnisse §5, Release-Ablauf, Fallstricke, Backlog). Was dort als untersucht/verworfen steht, nicht erneut untersuchen. `docs/konzept.md` ist historisch.

## Zusammenarbeit

- Nutzer: Philipp, Teamchef von Outcast Endurance; Kommunikation auf **Deutsch**.
- **Lokale Commits sind ok. Pushen, Tags/Releases** und andere Schritte nach außen **vorher bestätigen lassen** (Philipp sagt z. B. „ja, pushen und v0.9.1 veröffentlichen“).
- Firewall-/Systemeinstellungen macht Philipp selbst. Seine echte StintView-Installation und sein Profil nie anfassen.
- GitHub-Issue #1 (Wetter-Vorhersage) ist geschlossen: Vorhersage verworfen (02.10.2026, Begründung SPEC §5) – nicht erneut untersuchen.
- Bei Änderungen an Anforderungen, Architektur, Protokoll oder Release **SPEC.md mitpflegen**; bei sichtbaren Funktionen auch `ANLEITUNG.md` (de), `INSTALL.md` (en, mit den englischen UI-Bezeichnungen) und `docs/TESTPLAN.md`.

## Prüfen

- `pnpm test` (vitest), `pnpm -r typecheck`, Website-Build `node site/build.mjs` (prüft lokale Links und Platzhalter).
- **Jeder neue UI-Text** in beide Wörterbücher: `apps/overlay/src/i18n.ts` (Panels, Einrichtungsfenster; TypeScript erzwingt alle Schlüssel im Englischen) und `apps/overlay/electron/i18n.cjs` (Tray, Dialoge, Kürzel, Meldungen). Der Recorder liefert keine fertigen UI-Texte, sondern Codes (z. B. Kamera-Ergebnis `code` + `vars`).

## Testversion starten (ohne Philipps Installation zu stören)

- Testprofil: `STINTVIEW_HOME=<scratchpad>/app-home` (eigener Team-Server auf Port 8796, eigene Einstellungen). Bauen: in `apps/overlay` `npx vite build && node scripts/bundle.mjs`; starten im Hintergrund: `STINTVIEW_HOME=… npx electron . --remote-debugging-port=9333`.
- Steuern/Screenshots: `node scripts/cdp.mjs eval "<js>" "<route>"` bzw. `shot <datei.png> "<route>" [selector]`; Route = Ende der URL (`#/setup`, `#/`, `#/widget/<id>`), in Git-Bash mit `MSYS_NO_PATHCONV=1`. `eval` wartet nicht auf Promises.
- **Testprozesse nur gezielt beenden** (Electron/Node-Prozesse, deren Kommandozeile `stintview` bzw. `recorder.cjs|demo-standings|fake-hazard|cdp.mjs|main.ts replay` enthält) – **nie** `taskkill /IM StintView.exe` (trifft die echte Installation).
- Wenn der Monitor schläft, liefert das Monitor-Overlay keine Screenshots: Ausgabe auf VR stellen und die Offscreen-Seiten `#/widget/<id>` ganz (ohne Selector) aufnehmen – ohne laufendes SteamVR erscheint nichts in einer Brille.

## Daten für Tests

- Demo-Werkzeuge in `apps/recorder/src/dev/` (mit `STINTVIEW_CONFIG=<testprofil>/config.json npx tsx …`): `demo-standings.ts [--best]` (Position, Boxenstopp, Sprit; `--best` = Qualifying), `fake-hazard.ts` (Unfall voraus), `pitloss-from-ibt.ts` (Boxengassen-Verlust aus .ibt).
- Echte Aufzeichnung abspielen: `npx tsx src/main.ts replay <datei.ibt> --speed 30 --start <min>` (in `apps/recorder`). Gute Datei: `D:\iRacing\telemetry\porsche992rgt3_suzuka grandprix 2026-05-16 11-12-21.ibt` (Boxenstopps Min. 62 und 123). Der Test-Server merkt sich die aktive Session: zwischen Wiedergabe, Demo und fake-hazard die Testversion neu starten.
- .ibt-Dateien enthalten keine `CarIdx*`-Werte – Position/Boxenstopp/Überrundungen nur mit Demo-Daten oder live testbar.
- Philipps Telemetrie-Ordner: `D:\iRacing\telemetry` = `OneDrive\Documents\iRacing\telemetry`; Garage 61 und VRS laden die .ibt-Dateien hoch (deshalb kein Aufzeichnungs-Neustart-Trick, siehe SPEC §5).

## Website-Screenshots

- Deutsch in `site/assets/`, Englisch in `site/assets/en/` (Vorlage nutzt `{{SHOTS}}`). Echte Namen auf Bildern durch „Outcast Endurance“ ersetzen; im App-Bild Version und Standardkürzel (Strg+Umschalt+O/J/K) setzen, weil die Testversion Ausweichkürzel bekommt.

## Release

- SPEC.md: Kopfzeile „Stand: …, Version x.y.z.“ und Release-Liste ergänzen, committen, `git push origin main`, `git tag vX.Y.Z && git push origin vX.Y.Z`. Der Workflow baut Installer + `latest.yml`; die App aktualisiert sich selbst.
- `gh` ist nicht installiert: Status über `https://api.github.com/repos/ToyYoda/stintview/actions/runs` und `/releases/tags/vX.Y.Z` prüfen. Pages baut bei jedem Push auf main.

## Stolperfallen beim Arbeiten

- Bash-Heredocs mit Anführungszeichen/Backslashes gehen leicht kaputt: größere Python-Hilfsskripte mit dem Write-Tool als Datei anlegen und dann ausführen.
- Dateien mit `\u…`-Escapes nicht per sed bearbeiten (Backslashes gehen verloren).
