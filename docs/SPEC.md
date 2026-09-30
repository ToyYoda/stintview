# StintView – Spezifikation

Stand: 2026-09-30, Version 0.6.1. Diese Datei ist die maßgebliche Beschreibung von Zielen, Entscheidungen und Architektur.
`docs/konzept.md` ist das ursprüngliche Konzept (historisch; wo es abweicht, gilt diese Datei). Testplan für Team-Tests: [TESTPLAN.md](TESTPLAN.md).

## 1. Zweck und Anforderungen

StintView ist ein Werkzeug für das iRacing-Endurance-Team **Outcast Endurance** (Teamchef: Philipp, Repo-Besitzer `ToyYoda`).
Jedes Teammitglied fährt an seinem eigenen PC. Alle sollen die Daten des Teamkollegen sehen, der **gerade im Auto sitzt**.

| # | Anforderung | Status |
|---|---|---|
| A1 | Auf jedem Fahrer-PC läuft ein Hintergrundprogramm, das Telemetrie aufnimmt und **nur sendet, wenn der eigene Nutzer im Auto sitzt**. | umgesetzt (Recorder) |
| A2 | Ein Overlay über iRacing zeigt die Daten des aktuell fahrenden Teammitglieds. | umgesetzt |
| A3 | Die Verbindung zwischen den PCs ist **unabhängig von der iRacing-Authentifizierung**. | umgesetzt (Team-Code + Token) |
| A4 | Das Overlay läuft **auch in VR** (Teamchef nutzt Bigscreen Beyond 2e = SteamVR). | umgesetzt (SteamVR-Overlay) |
| A5 | Anzeigen nur, was iRacing Zuschauern **nicht** zeigt: **Steuereingaben** (Lenkung, Gas, Bremse), **Reifentemperatur und -abnutzung**, **Spritverbrauch pro Runde**. | umgesetzt, Reifen eingeschränkt (s. §5) |
| A6 | Im Overlay dürfen immer nur die Daten des **aktuell fahrenden** Fahrers erscheinen, obwohl alle Recorder laufen. | umgesetzt (Übernahme-Regeln §4) |
| A7 | Einfache Installation für Teammitglieder ohne Git/Node/Kommandozeile. | umgesetzt (Windows-Installer) |
| A8 | Der Team-Server läuft beim Teamchef zu Hause (Portfreigabe im Router, kein Cloud-Hosting). | umgesetzt (Relay in der App) |
| A9 | Download-Website mit Beschreibung und Anleitung, Design von Outcast Endurance, **Deutsch und Englisch**. | umgesetzt (GitHub Pages) |
| A11 | **Wetter** (GitHub-Issue #1): aktuelle Werte (Luft-/Streckentemperatur, Niederschlag, Wolken, Streckenzustand) und eine Liste der **Änderungen** statt iRacings 15-Minuten-Raster. **Vorhersage** gewünscht, aber über die Telemetrie nicht verfügbar (§5) – Issue bleibt dafür offen. | aktuell + Verlauf umgesetzt |
| A12 | Jede Anzeige einzeln wählbar, getrennt für Monitor und VR. | umgesetzt |
| A15 | **Transparenz:** Hintergrund-Deckkraft der Anzeigen einstellbar (0–100 %, Schritte 5 %), getrennt für Monitor (Standard 78 %) und VR (Standard 100 %); Schrift bleibt deckend. Einstellung `settings.opacity {monitor, vr}` (`cleanOpacity`), per IPC `opacity` (0–1) an Overlay-Fenster und VR-Panel-Seiten, CSS-Variable `--panel-alpha`; wirkt sofort, ohne VR-Neustart. | umgesetzt |
| A14 | **Übersicht aller Tastaturkürzel** im Einrichtungsfenster (Tray-Menü „Tastaturkürzel …“ öffnet `#/setup/keys`, Übersicht dann oben): tatsächlich registriertes Kürzel je Funktion, von anderen Programmen belegte Wunsch-Kürzel, Ausweich-Kürzel, inaktive Gruppen (Overlay/VR aus) ausgegraut. | umgesetzt |
| A13 | **Position:** P1–3 und je 3 Autos vor/hinter dem Team-Auto, Reihenfolge **auf der Strecke** (nicht iRacings Runden-Position); Spalten Position, Startnummer, Länderflagge + Name, Abstand in s (+ vor uns, ganze Runden als „R“; Farben: <1 s vor uns gelb, <1 s hinter uns rot, 1–3 s normal, >3 s grau, andere Runde blau), Reifenalter in Runden (eigenes Auto exakt über `xxodometer`/Streckenlänge, andere = Runden seit Verlassen der Boxengasse, „Box“ in der Boxengasse), Δ letzte Runde (unsere − seine; rot = wir langsamer, sonst grün). | umgesetzt |
| A10 | **Live-Zuschauer:** Bekommt der Fahrer Gelb (Unfall voraus), kann ein zuschauender Teamkollege per Knopf die Kamera in seinem iRacing zum Unfall-Auto springen lassen (Verfolgerkamera „Far Chase“) und per Knopf zurück zum Team-Auto. Absprache mit dem Fahrer über Discord (außerhalb von StintView). In VR per Tastenkürzel (Maus kann SteamVR-Panels nicht treffen). | umgesetzt, live noch ungetestet (§7a) |

Sprache für Nutzer: Deutsch (App-Oberfläche nur Deutsch; Website und Anleitung de/en).

## 2. Architektur

```
Fahrer-PC (im Auto)                     Teamchef-PC (Portfreigabe TCP 8787)          Alle PCs
┌──────────────────────┐   ws://…/ws    ┌──────────────────────────┐   ws://…/ws   ┌──────────────────────┐
│ StintView-App        │ ─────────────▶ │ StintView-App            │ ────────────▶ │ StintView-App        │
│  └ Recorder (utility)│  MessagePack   │  └ Relay-Server (utility)│               │  └ Overlay (Monitor) │
│    liest iRacing-SHM │                │    Team-Räume, Tokens    │               │  └ VR-Panels (SteamVR)│
└──────────────────────┘                └──────────────────────────┘               └──────────────────────┘
```

Eine einzige Electron-App auf jedem PC. Recorder läuft immer; Monitor-Overlay, VR-Panels und Relay per Schalter.

### Monorepo (pnpm-Workspace, TypeScript)

| Pfad | Inhalt |
|---|---|
| `packages/protocol` | Nachrichtentypen, `pack`/`unpack` (MessagePack), `PROTOCOL_VERSION` |
| `packages/telemetry` | reine Logik: `FuelTracker`/`fuelStats`, `TyreTracker`/`estimateWear`, `InputBatcher` (+ Tests) |
| `apps/recorder` | iRacing-Leser (`irsdk/live.ts` Shared Memory, `irsdk/ibt.ts` Replay), `recorder.ts` (Fahrer-Erkennung, Nachrichten), `connection.ts` (WS + Reconnect), CLI `main.ts` |
| `apps/server` | Relay: HTTP-API + WebSocket, `room.ts` (Übernahme-Regeln, + Tests), `store.ts` (Teams/Tokens als JSON) |
| `apps/overlay` | **Desktop-App** (Paketname `@stintview/overlay`, productName `StintView`): Electron-Hauptprozess in `electron/`, React-UI in `src/` |
| `site/` | Download-Website (Vorlage, Texte de/en, Build-Skript) |
| `tools/` | Python-Prüfskripte: `ibt_inspect.py`, `live_probe.py`, `live_vars.py` |
| `vendor/openvr` | `openvr_capi.h` + Lizenz (Valve, BSD) als Referenz für die Funktionstabelle |
| `vendor/irsdk` | `irsdk_defines.h` (iRacing SDK, BSD) – Broadcast-Befehle, Flags, TrkLoc |

### Desktop-App (`apps/overlay/electron/`)

| Datei | Aufgabe |
|---|---|
| `app.cjs` | Einstieg: Einzelinstanz, Tray-Menü, Einrichtungsfenster `#/setup`, Hintergrundprozesse überwachen/neu starten (5 s), Autostart (`--hidden`), Auto-Update, IPC |
| `config.cjs` | `%APPDATA%\StintView`: `config.json` (Team-Zugang), `app.json` (Einstellungen), `logs/`; Beitreten/Anlegen per HTTP |
| `overlay-window.cjs` | Monitor-Overlay: transparentes Vollbildfenster, `alwaysOnTop('screen-saver')`, click-through; Bearbeiten-Modus |
| `hotkeys.cjs` | Übersicht der globalen Tastaturkürzel (`hotkeyGroups`) aus `editHotkeyInfo` (overlay-window), `cameraHotkeyInfo` (camera), `vrHotkeyInfo` (vr); Anzeige „Strg/Umschalt/Bild↑“ |
| `vr.cjs` | VR-Host: Widgets offscreen rendern → D3D11-Texturen → SteamVR-Overlays; Platzierungs-Tastenkürzel |
| `openvr.cjs`, `d3d11.cjs` | FFI-Bindings per **koffi** (kein nativer Build) |
| `renderer.cjs`, `preload.cjs` | UI-Routen laden; `window.stintview`-API |

Recorder und Relay werden per esbuild (`scripts/bundle.mjs`) zu `dist-bundles/*.cjs` gebündelt und als Electron-`utilityProcess` gestartet (Nutzer brauchen kein Node). Logs: `%APPDATA%\StintView\logs\recorder.log` / `server.log`.

React-UI-Routen: `#/` alle Widgets (Monitor-Overlay), `#/widget/<header|inputs|fuel|tyres>` Einzel-Widget (VR, OpenKneeboard), `#/setup` Einrichtung/Status.

Einstellungen `app.json` (Default): `overlay: true`, `vr: false`, `autostart: true`, `server: false`, `serverPort: 8787`, `panels: { header|inputs|fuel|tyres|weather: { monitor, vr } }` (Wetter in VR standardmäßig aus). Geänderte VR-Auswahl startet den VR-Host neu; `vr.json` hält nur noch die Platzierung.

## 3. Protokoll (Version 3)

WebSocket-Pfad `/ws`, binäre Frames, MessagePack. Erste Nachricht des Clients: `hello { v, token, role: 'recorder'|'overlay' }` (5 s Timeout). Server antwortet `welcome` oder `error {code: auth|protocol|version}`.

| Nachricht | Richtung | Frequenz | Inhalt |
|---|---|---|---|
| `driving` | Recorder → Server | bei Wechsel + **alle 2 s** während der Fahrt | `driving`, `driverName`, `session` (= `SessionID/SubSessionID`) |
| `inputs` | Recorder → Overlays | 10/s, je 3 Samples (30 Hz) | `[steer rad, throttle, brake, clutch]`, `steerMax`, `speed`, `gear` |
| `status` | Recorder → Overlays | 2/s | `sessionTime`, `lap`, `lapDistPct`, `fuelLevel`, `onPitRoad`, `odometer` je Rad, `flags` (SessionFlags des Fahrers; v3) |
| `fuel` | Recorder → Overlays | pro Runde | letzte Runden `{lap, used, lapTime, pit}`, `tankCapacity` |
| `tyres` | Recorder → Overlays | bei Messung | Messungen `{lap, odometer, carcass L/M/R, wear L/M/R}` je Rad |
| `standings` | Recorder → Overlays | ~1/s | Zeilen `{pos, carIdx, number (CarNumber), name, lastLap, isTeam, gap?, lapsGap?, tyreLaps?, inPit?, country?}`; Flagge aus `DriverInfo.Drivers[].FlairName` (englischer Ländername, „Global“/„-none-“ = keine) → ISO-Code über `Intl.DisplayNames` plus Aliasse (`apps/recorder/src/country.ts`, England/Schottland/Wales als `gb-eng` usw.), Bilder aus dem Paket `flag-icons` (MIT, offline gebündelt – Windows zeigt keine Flaggen-Emojis); Abstand = Differenz `CarIdxEstTime` (über die Ziellinie mit unserer letzten Runde ergänzt, Fallback Distanz × Rundenzeit, `trackGap`); Boxenstopps (`CarIdxOnPitRoad` true→false) zählt `PitStopTracker` auf **jedem** Frame, auch ohne zu fahren, Reset bei neuer `SessionNum`; iRacing liefert **keinen** Reifenwechsel fremder Autos: Reihenfolge = `CarIdxLapCompleted + CarIdxLapDistPct`, bei mehreren Klassen innerhalb der Klasse des Team-Autos (`CarIdxClass`); `computeStandings` in `apps/recorder/src/standings.ts` (getestet); ohne Versionssprung |
| `hazard` | Recorder → Overlays | bei Änderung + alle 2 s solange aktiv | „Unfall voraus“: `active`, `carIdx`, `carNumber`, `driverName`, `distance` (m), `reason` (`slow`/`offtrack`), `speed`; ohne Versionssprung ergänzt |
| `weather` | Recorder → Overlays | alle 5 s + bei Änderung | `now` (Luft/Strecke °C + Trend, `skies` 0–3, `precipitation` 0–1, `wetness` 0–7, `declaredWet`, Tageszeit), `events` (Änderungen); ohne Versionssprung ergänzt (alte Clients ignorieren es, Server muss es kennen) |
| `session` | Recorder → Overlays | bei Änderung | Strecke, Auto, Fahrer, Team, Session-Typ, `carIdx`, `carNumber` (CarNumberRaw), `sessionId` (v3) |
| `active` | Server → Overlays | bei Wechsel | aktiver Fahrer (Name, Mitglied) |
| `snapshot` | Server → Overlay | beim Verbinden | `active` + letzte Telemetrie |
| `standby` | Server → Recorder | bei abgelehntem Anspruch | `reason: other-driver|other-session` |

HTTP: `POST /api/teams {teamName, memberName}`, `POST /api/join {inviteCode, memberName}` → `{teamId, teamName, memberName, inviteCode, token}`; `GET /health`. Tokens werden serverseitig nur gehasht gespeichert (`teams.json`). Einladungscode Format `XXXX-XXXX` ohne verwechselbare Zeichen.

**Versionsregel:** Protokolländerungen erhöhen `PROTOCOL_VERSION`; der Server lehnt abweichende Clients ab (`version`). Deshalb müssen alle Teammitglieder aktualisieren – das Auto-Update erledigt das.

## 4. Übernahme-Regeln (wer ist „aktiver Fahrer“)

Implementiert in `apps/server/src/room.ts`, getestet in `room.test.ts`.

1. Der Recorder meldet `driving=true` nur, wenn iRacing **`IsOnTrack`** meldet **und** der lokale Nutzer der **aktuelle Fahrer seines Autos** ist (`DriverInfo.DriverUserID` = `UserID` des Eintrags mit `CarIdx = DriverCarIdx`). **Wichtig (Rennen 29.09.2026):** In Teamrennen meldet iRacing `IsOnTrack` auch bei Teammitgliedern, die das Team-Auto verfolgen, während ein anderer fährt – ohne die Nutzer-ID-Prüfung hielt sich der Recorder des Teamchefs für den Fahrer (falscher aktiver Fahrer, und dieses Teammitglied konnte nicht zum Unfall springen, weil „du fährst gerade“). Verlassen des Autos wird nach 3 s Entprellung gemeldet; verschwindet iRacing während der Fahrt, meldet der Recorder sofort „ausgestiegen“.
1a. Der Server gibt den aktiven Fahrer frei, wenn er **10 s** weder Daten noch Ansprüche geschickt hat (`Room.expire`, alle 2 s) – vorher blieb ein Fahrer nach einem iRacing-Absturz bis zu einer Stunde „aktiv“.
2. Ein Fahrer, der **Daten sendet**, wird **nie verdrängt** (verhindert Flattern bei zwei Team-Autos oder zu frühem Einsteigen). Nur wenn er **10 s** nichts gesendet hat (`ACTIVE_STALE_MS`), darf jemand übernehmen.
3. Ein Anspruch aus einer **anderen iRacing-Session** wird abgelehnt, solange die letzte Team-Session vor weniger als **5 min** Daten lieferte (`SESSION_STALE_MS`) – z. B. Teamkollege im Training parallel zum Rennen.
4. Abgelehnte Recorder erhalten `standby` und fordern alle 2 s erneut an → Übernahme nach Fahrerwechsel binnen Sekunden.
5. Nur Telemetrie des aktiven Recorders wird weitergeleitet. Sprit-Runden und Reifenmessungen werden über Fahrerwechsel hinweg zusammengeführt; bei neuer Session/Session-Typ zurückgesetzt.

Grenze: Ein Team mit **zwei Autos** sieht nur das Auto, das zuerst sendet (sonst zwei Teams anlegen).

## 5. iRacing-Daten – Messergebnisse (nicht erneut untersuchen)

Gemessen an `D:\iRacing\telemetry\porsche992rgt3_nurburgring combinedshortb 2026-06-06 19-42-35.ibt` (4,2 h Teamrennen, 60 Hz) und live (BMW M8 GTE, 335 Live-Variablen, Liste per `tools/live_vars.py`).

| Daten | Live-Speicher (irsdk) | Bemerkung |
|---|---|---|
| `SteeringWheelAngle`, `Throttle`, `Brake`, `Clutch`, `Speed`, `Gear` | ✅ 60 Hz | |
| `FuelLevel`, `Lap`, `LapDistPct`, `OnPitRoad` | ✅ | Verbrauch/Runde aus Differenz; nur Abnahmen zählen (Nachtanken!), Runde 0 und Box-Runden nicht in Ø |
| `xxtempCL/CM/CR` (Karkasse), `xxwearL/M/R` | ✅ aber **nur beim Stopp in der Box aktualisiert** | misst den **alten** Satz beim Einfahren in die Box; danach springt `xxodometer` auf 0, wenn Reifen gewechselt |
| `xxodometer`, `xxcoldPressure` | ✅ | coldPressure = Garagen-Kaltdruck, nicht aktueller Druck |
| `xxtempL/M/R` (Oberfläche), `xxpressure` (aktueller Druck) | ❌ **nicht live**, nur in `.ibt` | Dashboard-Werte (TPMS) zeigt iRacing nur intern an |
| `.ibt` während der Fahrt | ❌ | wird in Echtzeit geschrieben (~64 KB/s), aber **exklusiv gesperrt** (WinError 32) |

**Live aus der `.ibt` – untersucht 30.09.2026, vom Nutzer abgelehnt:** Die `.ibt` enthält Oberflächentemperatur und heißen Druck mit 60 Hz (echte Live-Werte). Mitlesen geht nicht: iRacing öffnet die laufende Datei **exklusiv** (Windows-Fehler 32, jede Freigabe-Option). Der SDK-Befehl `irsdk_BroadcastTelemCommand` + `Restart` schließt sie in 0,5 s, danach lesbar (~0,5 s Rückstand) – das erzeugt aber pro Intervall eine eigene Datei; Garage 61 lädt jede sofort hoch, VRS nutzt die Dateien ebenfalls, der Ordner liegt bei Philipp in OneDrive. **Entscheidung: nicht umsetzen.** Testwerkzeug: `tools/ibt_tail_probe.py`.

Folge für das Reifen-Widget: letzte Messung (Karkasse, Verschleiß) + km auf dem Satz + Verschleiß-Prognose (`(1 − Verschleiß) / km` der letzten Messung × aktuelle km). Keine Umgehungen (Hooks o. ä.) wegen Anti-Cheat.
Fahrer-Name im Overlay kommt aus der iRacing-Session (`UserName`), nicht aus dem StintView-Mitgliedsnamen; Namen spielen für die Erkennung keine Rolle.

**Wetter:** live verfügbar sind `AirTemp`, `TrackTempCrew`, `Skies` (0 klar … 3 bedeckt), `Precipitation` (0–1), `TrackWetness` (irsdk_TrackWetness 0–7), `WeatherDeclaredWet`, `SessionTimeOfDay` (auch in der `.ibt`). Eine **Vorhersage** steht weder in der Telemetrie noch in den Session-Infos (nur Wetter-Einstellungen wie „Realistic/Dynamic“); möglich wäre nur iRacings Web-Data-API mit iRacing-Login (nicht geprüft). Änderungen erkennt `WeatherTracker` (`packages/telemetry/src/weather.ts`, getestet): Kategorien müssen 30 s stabil sein, Temperatur-Ereignisse ab 2 °C (Luft) / 3 °C (Strecke), Trend über 10 min ab 1 °C. Der Server führt die Ereignisse über Fahrerwechsel zusammen.

Sonstiges: Der Shared-Memory-Bereich existiert auch, wenn nur die iRacing-UI läuft, teils mit **eingefrorenem** letzten Frame → der Recorder gilt nach 2 s ohne neuen Tick als „iRacing nicht aktiv“.

## 6. VR (SteamVR)

- Jedes Widget = eigenes SteamVR-Overlay, platziert relativ zur Sitzposition (`TrackingUniverseSeated`), Default 80 cm vor/unter Augenhöhe, Layout in `%APPDATA%\StintView\vr.json`.
- OpenVR über `openvr_api.dll` der installierten SteamVR-Runtime (Pfad aus `%LOCALAPPDATA%\openvr\openvrpaths.vrpath`), Funktionstabelle `FnTable:IVROverlay_028`. SteamVR wird nie selbst gestartet (Probe mit App-Typ Background, dann Overlay).
- Bildübergabe: Chromium-Offscreen-Rendering (2× Zoom) → **D3D11-Textur (B8G8R8A8, zwei im Wechsel) → `SetOverlayTexture`**. `SetOverlayRaw` ist **ungeeignet** (flackert, nach ~150 Uploads dauerhaft `RequestFailed`). D3D11-vtable-Indizes gegen Windows-SDK `d3d11.h` geprüft (CreateTexture2D 5, UpdateSubresource 48, Flush 111).
- Getestet auf Bigscreen Beyond 2e: flackerfrei, ~32 Uploads/s. Quest ohne SteamVR: nicht unterstützt (Alternative OpenKneeboard mit `#/widget/<id>`).
- Platzierung per Tastatur: Strg+Umschalt+V (Panel wählen), +Pfeile, +Bild↑/↓, +Plus/Minus, +H.

## 7. Bedienung Monitor-Overlay

- iRacing muss im **randlosen Fenster** laufen.
- Bearbeiten-Modus (Widgets ziehen): Knopf „Anzeigen verschieben“ im Fenster/Menü, Knopf „Fertig“ im Overlay-Banner, oder Tastenkürzel = **erstes freies** aus Strg+Umschalt+O, Strg+Alt+O, Strg+Umschalt+F9 (AMD Radeon Software belegt Strg+Umschalt+O). Positionen im localStorage des Overlays.

## 7a. Zuschauer-Kamera („Zum Unfall“)

- **Hauptauslöser „Unfall voraus“ (seit 0.5.0):** Im echten Rennen kam trotz vieler Unfälle **nie** eine gelbe Flagge; der iRacing-Spotter-Ruf („incident ahead“) ist **nicht** im SDK (nur `CarLeftRight`). Deshalb läuft auf dem **Fahrer-PC** `HazardDetector` (`apps/recorder/src/hazard.ts`, getestet): ~4×/s `findIncidentCar` mit strengeren Schwellen – bis **1500 m** voraus, **< 30 km/h** oder **neben der Strecke und < 80 km/h** (Tracklimit-Ausritte zählen nicht), **2 Prüfungen** in Folge; bleibt bis **5 s** nach der letzten Sichtung aktiv; nicht in der Boxengasse. Meldung `hazard` (Auto-Index/-Nummer/-Name, Abstand, Grund) bei Änderung und alle 2 s; jede Meldung steht im `recorder.log` des Fahrers (`[hazard] …`) zum Nachjustieren. Knopf und Kürzel springen **direkt** auf dieses Auto (`targetCarIdx`), ohne erneute Suche beim Zuschauer.
- **Zusatzauslöser Gelb:** `status.flags` des aktiven Fahrers enthält `YELLOW_FLAGS` (yellow `0x8`, yellowWaving `0x100`, caution `0x4000`, cautionWaving `0x8000`). Lokale Gelbphasen dauern ~10 s (gemessen in der `.ibt`: 5 Phasen, nur `0x100`) → Banner bleibt 20 s nach Ende stehen.
- **Ablauf:** Overlay-Knopf bzw. Kürzel → `electron/camera.cjs` → Recorder-Utility-Process (`postMessage`) → `apps/recorder/src/spectator.ts` auf dem **lokalen** iRacing des Zuschauers.
- **Unfall-Auto:** `findIncidentCar` (getestet): nächstes Auto **vor** dem Team-Auto (≤ 3 km, über Start/Ziel), das `CarIdxTrackSurface = OffTrack` hat oder < 30 km/h fährt (Geschwindigkeit aus `CarIdxLapDistPct` zweier Momentaufnahmen ~1 s, Streckenlänge aus `WeekendInfo.TrackLength`); Box/NotInWorld ausgenommen. Nichts gefunden → `CamFocus.AtIncident (-3)` (iRacings letzter Unfall).
- **Kamera:** Broadcast `CamSwitchNum` (= 1) mit `CarNumberRaw`, Gruppe „Far Chase“ (GroupNum aus `CameraInfo`), Kamera 0; Nachricht `IRSDK_BROADCASTMSG` per `SendNotifyMessageA(HWND_BROADCAST, id, MAKELONG(msg, var1), MAKELONG(var2, var3))`. Konstanten aus `vendor/irsdk/irsdk_defines.h` (zwei unabhängige Kopien verglichen). „Zurück“ stellt die vorherige Kameragruppe wieder her.
- **Erfolgskontrolle (seit 0.5.2):** Die Broadcast-Nachricht liefert keine Rückmeldung; Windows verwirft sie **stillschweigend**, wenn iRacing mit höheren Rechten (als Administrator) läuft als StintView (UIPI). Deshalb gilt ein Sprung erst als erfolgreich, wenn `CamCarIdx` innerhalb von **1,5 s** das Ziel-Auto zeigt; sonst Meldung „iRacing hat den Kamerawechsel nicht angenommen …“ mit Hinweis auf den Administrator-Modus. Anlass: Rennen 29.09.2026 – bei einem Teammitglied meldete die App den Sprung, die Kamera bewegte sich aber nicht (Ursache noch unbestätigt, Administrator-Modus vermutet). Nicht prüfbar: der Rückfall `FocusAtIncident` (iRacing wählt das Auto selbst).
- **Protokoll:** jeder Kamera-Befehl steht im `recorder.log` (`[camera] incident car 12 requested`, `[camera] switch to car …`, `[camera] ok|failed: …`).
- **Schutz:** nichts tun, wenn der Zuschauer selbst fährt (Regel §4.1), iRacing nicht läuft oder die lokale `sessionId` nicht zur Team-Session passt.
- **Knöpfe (seit 0.6.0) fest** in der ersten Zeile: „Zum Unfall“ (aktiv bei Warnung) und „Zurück“ (aktiv, solange `CamCarIdx` ≠ Team-`carIdx`), feste Breite, „…“ bis zur Bestätigung. Anlass: Rennen 29.09. – Knöpfe verrutschten mit wechselndem Text/Zeilen unter dem Mauszeiger, wiederholte Klicks trafen abwechselnd beide (36 Befehle in 7 s). Zusätzlich ignoriert `camera.cjs` Befehle < 1 s nach dem vorigen. Ursache des ausbleibenden Sprungs war dort **iRacing im Administrator-Modus** (bestätigt).
- **Klickbar im click-through-Overlay:** Seite meldet Zeiger über Knopf (`overlay:interactive`) → Fenster nimmt nur dann Maus-Eingaben an; bleibt nicht fokussierbar (iRacing behält den Fokus).
- **Kürzel:** erstes freies aus Strg+Umschalt+J / Strg+Alt+J / Strg+Umschalt+F7 (zum Unfall) und Strg+Umschalt+K / Strg+Alt+K / Strg+Umschalt+F8 (zurück); im StintView-Fenster angezeigt, VR-Panels zeigen die Kürzel statt Knöpfen.
- **Test:** Banner per `.ibt`-Replay (Minute 22,4) geprüft; `.ibt` enthält **keine** `CarIdx*`-Daten → Unfallsuche und Kamerasprung nur live testbar (z. B. offizielles Rennen als Zuschauer).

## 8. Installer, Updates, Website

- **Installer:** electron-builder (`apps/overlay/electron-builder.yml`), NSIS one-click, pro Benutzer (keine Adminrechte), `StintView-Setup.exe` ~82 MB, **nicht signiert** (SmartScreen-Warnung, bewusst: erst mal ohne Zertifikat). appId `com.outcastendurance.stintview`. Installationsordner derzeit `%LOCALAPPDATA%\Programs\@stintviewoverlay` (Schönheitsfehler, s. §11).
- **Release:** Tag `vX.Y.Z` pushen → `.github/workflows/release.yml` (windows-latest, pnpm aus `packageManager`, Tests, Version aus Tag) baut und veröffentlicht auf GitHub Releases. Veröffentlicht: v0.2.1, v0.2.2, v0.3.0 (Protokoll v3), v0.4.0 (Wetter, Anzeigen-Auswahl), v0.5.0 („Unfall voraus“), v0.5.1 (Fix aktiver Fahrer im Teamrennen), v0.5.2 (Kamera-Erfolgskontrolle, Update per Klick), v0.6.0 (Positions-Panel mit Abstand, Reifenalter, Flaggen; Tastaturkürzel-Übersicht; feste Kamera-Knöpfe), v0.6.1 (einstellbare Transparenz Monitor/VR; `v0.2.0` = Tag ohne Release, erster Lauf scheiterte).
- **Auto-Update:** electron-updater (GitHub-Provider) in `electron/updates.cjs`: Prüfung beim Start und **stündlich**, Download im Hintergrund, dann Hinweis (Windows-Benachrichtigung) und Knopf **„Update … installieren und neu starten“** im Fenster und im Tray-Menü (`quitAndInstall`, still, startet neu); ohne Klick Installation beim Beenden. Menüpunkt „Nach Updates suchen“. Getestet mit lokal als 0.5.0 gebautem Programmordner gegen das Release 0.5.1 (Suchen → Laden → bereit in 7 s); der Klick selbst (Installation) wurde nicht getestet, um die echte Installation nicht zu überschreiben. Hinweis: `electron-builder --dir` erzeugt kein `app-update.yml` – nur der Installer enthält es.
- **Website:** <https://toyyoda.github.io/stintview/> (de) und `/en/`, gebaut von `.github/workflows/pages.yml` bei jedem Push auf `main` aus `site/template.html` + `site/strings.mjs` + `ANLEITUNG.md`/`INSTALL.md` (Titel und Intro bis zur ersten `---` werden entfernt). Download-Knopf → `releases/latest/download/StintView-Setup.exe`. Build bricht bei kaputten lokalen Verweisen ab.
- **Design Outcast Endurance:** Farben `#E5E5E5`, `#D10F0F`, `#1A1A1A` auf fast Schwarz; kursive fette Großbuchstaben; gesperrte rote Zwischenzeilen; Parallelogramm-Knöpfe; „O“-Emblem mit rotem Schrägstrich (SVG-Nachbau); Slogan „Race together. Outperform. Never belong.“; Auto-Bild `site/assets/livery.webp` (Design-Blatt, per CSS beschnitten). Keine Sponsorenlogos nachbauen. Keine externen Fonts (Datenschutz).

## 9. Betrieb beim Teamchef

- Router: Portweiterleitung **nur TCP 8787** (kein UDP) auf den PC; feste interne IP; am besten DynDNS.
- Windows fragt beim ersten Relay-Start nach Firewall-Freigabe → erlauben.
- Teams: `%APPDATA%\StintView\server\teams.json` sichern.
- Verbindung ist **unverschlüsselt** (`ws://`); Empfehlung für Dauerbetrieb: Reverse-Proxy mit TLS (z. B. Caddy + Let's Encrypt) – offen.

## 10. Entwicklung und Tests

- `pnpm install`, `pnpm app` (Dev), `pnpm test` (12 Tests), `pnpm typecheck`, `pnpm dist` (lokaler Installer).
- Recorder-CLI für Tests ohne iRacing: `pnpm recorder replay "<datei.ibt>" --start <min> --speed <x> [--loop]`; Mitlesen: `apps/recorder/src/dev/listen.ts`.
- Getrenntes Testprofil neben installierter App: `STINTVIEW_HOME=<ordner>` (auch eigenes Electron-Profil/Instanz-Sperre); App fernsteuern mit `--remote-debugging-port=9333` + `apps/overlay/scripts/cdp.mjs eval|drag|shot [route]` (Route per URL-Ende, z. B. `index.html#/`).
- VR-Diagnose: `STINTVIEW_VR_DUMP=<ordner>` (PNG je Panel, ohne SteamVR), `STINTVIEW_VR_FPS`.

### Bekannte Fallstricke (bereits einmal passiert)

- **Electron + koffi:** `koffi.view()` (externe ArrayBuffer) ist im Electron-V8-Speicherkäfig verboten → Absturz. Shared Memory per `RtlMoveMemory` in eigene Buffer kopieren.
- **`pnpm server` ist ein pnpm-Builtin** → Skript heißt `pnpm relay`.
- **Paket ist `"type": "module"`** → gebündelte CommonJS-Dateien brauchen `.cjs`.
- **electron-builder lokal:** `winCodeSign`-Archiv enthält macOS-Symlinks → ohne Windows-Entwicklermodus manuell mit `7za x … -xr!darwin` nach `…\Cache\winCodeSign\winCodeSign-2.6.0` entpacken. Auf GitHub-Runnern kein Problem.
- **pnpm/action-setup:** Version nicht zusätzlich im Workflow angeben (kommt aus `packageManager`).
- **Dateien mit Windows-Pfaden nicht per Python-Heredoc schreiben** (`\t`, `\v` werden zu Steuerzeichen) – Write/Edit-Werkzeug oder Skriptdatei nutzen.
- Website-Seiten in Unterordnern (`/en/`): alle lokalen Pfade über `{{BASE}}`, auch in CSS.

## 11. Offene Punkte / Backlog

0. „Unfall voraus“ im Rennen prüfen: Fehlalarme/verpasste Unfälle anhand `[hazard]`-Zeilen im `recorder.log` des Fahrers, Schwellen (1500 m, 30/80 km/h) justieren.
0. Zuschauer-Kamera live testen (§7a): Knopf-Klick im Overlay, Sprung auf „Far Chase“, „Zurück“, Suchradius 3 km auf der Nordschleife bewerten.
1. Auto-Update 0.2.1 → 0.2.2 beim Teamchef verifizieren; echtes Installieren testen.
2. Recorder mit **laufendem iRacing** in der App testen (neue `RtlMoveMemory`-Auslese nur ohne Sim geprüft); VR in der installierten App mit SteamVR testen.
3. Erster Start auf einem PC ohne Node.js (Teamkollege); Firewall-Abfrage des Relays.
4. Installationsordner `@stintviewoverlay` → `StintView` (electron-builder `extraMetadata.name`; Update-Verhalten vorher prüfen).
4a. Wettervorhersage (Issue #1): prüfen, ob iRacings Data API eine Vorhersage für gehostete/offizielle Sessions liefert und wie ein Login dafür aussähe.
5. ~~Stint-Zusammenfassung aus der `.ibt`~~ – verworfen (30.09.2026): Telemetrie-Auswertung nach dem Stint macht das Team in Garage 61.
6. App-Oberfläche/Overlay zweisprachig (derzeit nur Deutsch).
7. TLS für das Relay; Code-Signing-Zertifikat (z. B. Azure Trusted Signing) gegen SmartScreen.
8. Mehrere Team-Autos in einem Team; Strategie-Features (Pit-Fenster, Stint-Planung, Gaps) – ursprüngliche „Später“-Liste im Konzept.

## 12. Arbeitsweise mit dem Nutzer

- Kommunikation auf Deutsch; der Nutzer testet selbst mit iRacing und Beyond 2e, oft allein (keine Mehr-PC-Tests möglich → simulieren: mehrere Recorder mit eigenen Zugängen, `.ibt`-Replay).
- Pushes, Tags/Releases und andere Schritte nach außen vorher bestätigen lassen; lokale Commits sind in Ordnung.
- Firewall-/Systemeinstellungen nimmt der Nutzer selbst vor.
