# StintView – Konzept

> **Historisch.** Ursprüngliches Konzept aus der Planungsphase. Maßgeblich ist [SPEC.md](SPEC.md) – dort sind spätere Entscheidungen (Desktop-App mit Installer, D3D11-VR, Übernahme-Regeln, Messergebnisse) festgehalten.

Live-Telemetrie des aktuell fahrenden Teammitglieds als Overlay über iRacing – für Endurance-Teams, deren Fahrer an eigenen PCs sitzen.

## Ziel

- Jedes Teammitglied sieht die Daten des aktuellen Fahrers, die iRacing beim Zuschauen **nicht** zeigt: Steuereingaben, Reifentemperatur/-verschleiß, Spritverbrauch pro Runde.
- Läuft am Monitor **und in VR**.
- Fahrerwechsel werden automatisch erkannt – niemand muss etwas umschalten.
- Team-Verbindung ist **unabhängig vom iRacing-Login** (eigene Team-Codes / eigener Account).

## Systemübersicht

```
 Fahrer-PC A (fährt gerade)          Fahrer-PC B / C / D (nicht am Steuer)
┌───────────────────────────┐       ┌───────────────────────────┐
│ iRacing                    │       │ iRacing (Spectate/Replay)  │
│   │ Shared Memory (irsdk)  │       │                            │
│   ▼                        │       │  ┌──────────────────────┐  │
│ ① Recorder (Hintergrund)   │       │  │ ② Overlay            │  │
│   - erkennt: "ich fahre"   │       │  │  transparent,        │  │
│   - sendet nur dann        │       │  │  always-on-top,      │  │
└────────────┬──────────────┘       │  │  click-through       │  │
             │ WSS (MessagePack)    │  └──────────▲───────────┘  │
             ▼                      └─────────────┼──────────────┘
      ┌─────────────────────────────────┐         │ WSS
      │ ③ Relay-Server                  │─────────┘
      │  - Team-Räume (per Team-Code)   │
      │  - letzter Zustand pro Team     │
      │  - Fan-out an alle Overlays     │
      └─────────────────────────────────┘
```

Auf jedem PC laufen **Recorder** (immer, im Tray) und optional **Overlay**. Der Fahrer selbst kann das Overlay ebenfalls nutzen.

## Komponenten

### ① Recorder (Hintergrunddienst)

- Tray-App, startet mit Windows, minimaler Ressourcenverbrauch (darf die Sim-Performance nicht beeinflussen).
- Liest die iRacing-Shared-Memory (`Local\IRSDKMemMapFileName`) inkl. Session-YAML.
- **Fahrer-Erkennung:** Sendet nur, wenn
  - `IsOnTrack == true` bzw. im Auto (`IsOnTrackCar`), **und**
  - der aktuelle Fahrer des Team-Autos (`DriverInfo.Drivers[PlayerCarIdx].UserID`) der eigenen iRacing-User-ID entspricht.
- Sendet ~10 Hz Live-Werte, Rundendaten bei Rundenabschluss, Session-Infos bei Änderung.
- Puffer bei Verbindungsabbruch, automatischer Reconnect.

### ② Overlay

**Grundsatz: Das Overlay zeigt nur, was iRacing Teammitgliedern *nicht* zeigt.** Beim Zuschauen im Team-Auto liefert iRacing nur Position, Rundenzeiten usw. – Eingaben, Reifen- und Verbrauchsdaten des Fahrers fehlen.

**Widgets (MVP):**

| Widget | Quelle (irsdk) | Verfügbarkeit |
|---|---|---|
| **Steuereingaben** – Lenkwinkel, Gas, Bremse (+ Kupplung) als Live-Balken und scrollende Input-Trace (~5 s) | `SteeringWheelAngle`, `SteeringWheelAngleMax`, `Throttle`, `Brake`, `Clutch` | ✅ live, 60 Hz |
| **Spritverbrauch** – letzte Runde, Ø der letzten 3/5 Runden, Stand, Runden übrig | `FuelLevel` (Differenz je Runde via `Lap`/`LapDistPct`), `FuelUsePerHour` | ✅ live, im Recorder berechnet |
| **Reifen** – Temperatur (innen/mitte/außen) und Verschleiß je Reifen | `LFtempCL/CM/CR`, `LFwearL/M/R` … | ⚠️ siehe unten |
| Kopfzeile: aktiver Fahrer, Datenalter/Verbindung | Server | ✅ |

**Reifendaten – Analyse der `.ibt` (Porsche 992 GT3 R, Nordschleife-Kombination, 4,2 h Teamrennen, 60 Hz, 287 Kanäle):**

| Kanal | Verhalten im Rennen |
|---|---|
| `xxtempL/M/R` (Oberfläche, je Reifen innen/mitte/außen) | ✅ **ändert sich live während der Fahrt** (z. B. 42 → 33 °C in der Einführungsrunde) |
| `xxtempCL/CM/CR` (Karkasse) | ⏸ eingefroren auf der Strecke, springt nur bei Boxenstopps (4 Stopps = 4 Updates) |
| `xxwearL/M/R` (Profil übrig) | ⏸ wie Karkasse, nur bei Boxenstopps |
| `xxpressure`, `xxodometer` | ✅ live |

**Live-Test (`tools/live_probe.py`, 2026-09-28, BMW M8 GTE, Nordschleife, auf der Strecke):**

| Kanal | Live-Speicher (irsdk) | nur `.ibt` |
|---|---|---|
| Karkasstemp. `xxtempCL/CM/CR`, Verschleiß `xxwearL/M/R` | ✅ (aber nur bei Stopp aktualisiert) | |
| Oberflächentemp. `xxtempL/M/R` | | ❌ |
| Reifendruck `xxpressure`, Radgeschw. `xxspeed`, Fahrhöhe | | ❌ |
| `xxodometer`, `xxcoldPressure`, Bremsdruck, Dämpferweg | ✅ | |
| Lenkung, Gas, Bremse, Kupplung, Fuel, Lap | ✅ | |

Die `.ibt` wird zwar in Echtzeit geschrieben (~64 KB/s, 1-s-Blöcke), iRacing öffnet sie aber **exklusiv** – Mitlesen scheitert mit Sharing-Violation (WinError 32). Live-Oberflächentemperaturen und Live-Reifendruck sind damit **nicht verfügbar** (Umgehungen wie Treiber-/Hook-Tricks kommen nicht in Frage).

Konsequenz fürs Overlay (Reifen-Widget):
- **Karkasstemperatur + Verschleiß vom letzten Stopp**, beschriftet „gemessen bei Stopp, Runde X“; Verlauf über die Stopps.
- **km auf dem Satz live** (Odometer) + **Verschleiß-Prognose**: Verschleiß je km aus den bisherigen Stopps × aktuelles Odometer.
- **Nach dem Stint:** Sobald der Fahrer aussteigt, schließt iRacing die `.ibt`. Der Recorder wertet sie dann aus und schickt eine Stint-Zusammenfassung (Oberflächentemperaturen je Runde, Drücke) ans Team – nützlich für den nächsten Fahrer, aber nicht live.

**Spritverbrauch – aus der `.ibt` verifiziert:** Runde für Runde über `FuelLevel`-Differenz bei `Lap`-Wechsel: stabil 13,2–13,5 l/Runde (~8 min). Nachtank-Runden (Tank steigt, `OnPitRoad`) und Runde 0 werden ausgeschlossen, sonst entstehen negative Werte.

**Darstellung – Desktop *und* VR:** Das Overlay wird als **Web-UI** (React) gebaut, die der Overlay-Prozess lokal ausliefert (`http://localhost:<port>`). Dieselbe UI wird auf zwei Wegen angezeigt:

1. **Desktop:** Electron-Fenster – transparent, always-on-top, click-through, Edit-Modus per Hotkey. Voraussetzung: iRacing im Borderless-Windowed-Modus.
2. **VR:** siehe nächster Abschnitt.

Zusätzlich als normales Fenster nutzbar (zweiter Monitor, Teammitglied ohne laufendes iRacing).

### ② b) VR-Unterstützung

iRacing läuft je nach Headset über **OpenXR** (Quest/Link, Pimax, Varjo, WMR …), **OpenVR/SteamVR** oder das **Oculus-SDK**. Ein Overlay muss sich in die jeweilige Runtime einklinken – ein Desktop-Fenster ist in VR unsichtbar.

| Option | Abdeckung | Aufwand | Bewertung |
|---|---|---|---|
| A) **OpenKneeboard** als Träger – unsere Web-UI als „Web Dashboard“-Tab | OpenXR, SteamVR, Oculus | sehr gering | Fallback für Headsets ohne SteamVR (z. B. Quest via Link) |
| B) Eigenes **SteamVR-Overlay** (`IVROverlay`, Bild aus Electron-Offscreen-Rendering) | alles, was über SteamVR läuft – egal ob iRacing im OpenVR- oder OpenXR-Modus | mittel | **Empfehlung**: Bigscreen Beyond 2e ist ein reines SteamVR-Headset (Lighthouse-Tracking) |
| C) Eigener **OpenXR-API-Layer** (C++) | alle OpenXR-Runtimes | hoch | nur falls A/B nicht reichen |

Übergangslösung zum Testen ohne eigenen VR-Code: Desktop-Overlay-Fenster per **Desktop+** (kostenlos, Steam) oder OVR Toolkit in SteamVR einblenden.

**Umsetzung (Option B, getestet 2026-09-28 auf Bigscreen Beyond 2e):** `apps/overlay/electron/vr.cjs`
- Jedes Widget rendert in einem unsichtbaren Electron-Offscreen-Fenster (`#/widget/<id>`, 2× Zoom für Schärfe) und wird ein eigenes SteamVR-Overlay, platziert relativ zur Sitzposition (`TrackingUniverseSeated`).
- OpenVR per FFI (koffi) über die `openvr_api.dll` der installierten SteamVR-Runtime, Funktionstabelle `FnTable:IVROverlay_028` (Header: `vendor/openvr/openvr_capi.h`). Kein nativer Build.
- Bildübergabe über eine eigene **D3D11-Textur** (`SetOverlayTexture`, zwei Texturen je Panel im Wechsel, BGRA direkt aus Chromium). `SetOverlayRaw` ist für laufende Updates **ungeeignet**: flackert bei jedem Update und lehnt nach ~150 Uploads alle weiteren mit `RequestFailed` ab.
- Messung: ~32 Uploads/s über alle Panels, 0 verworfen.

Anforderungen an die UI dafür: feste Seitengröße/Seitenverhältnis je Widget, hoher Kontrast, große Schrift, keine Maus-Interaktion nötig, einzelne Widgets als eigene URLs (`/widget/inputs`, `/widget/fuel`, `/widget/tyres`), damit sie in VR getrennt platziert werden können.
**Spike vor Umsetzung:** Web-Tab in OpenKneeboard mit iRacing in VR testen – Bildrate der Input-Trace, Lesbarkeit, Performance-Einfluss.

### ③ Relay-Server

- WebSocket-Server, gruppiert Verbindungen in **Team-Räume**.
- Hält den letzten Zustand je Team im Speicher → neue Overlays sind sofort befüllt.
- Setzt **eine aktive Quelle pro Team** durch (bei Fahrerwechsel übernimmt der neue Recorder).
- Kein iRacing-Bezug: Authentifizierung über eigenen Team-Code + Mitglieds-Token (MVP), später optional Discord-Login.

## Authentifizierung (unabhängig von iRacing)

MVP:
1. Team-Captain erstellt ein Team → Server liefert **Team-ID + Einladungscode**.
2. Mitglieder treten mit dem Code bei → erhalten ein langlebiges **Geräte-Token** (lokal gespeichert, Windows DPAPI).
3. Jede WS-Verbindung authentifiziert sich zuerst mit dem Token; der Server ordnet sie dem Team-Raum zu.

Die iRacing-User-ID wird nur **lokal** zur Fahrer-Erkennung genutzt und optional als Anzeige-Metadatum mitgeschickt – es gibt keinen Login bei iRacing.

## Datenprotokoll (Entwurf)

Binär via MessagePack über WSS. Nachrichtentypen:

| Typ | Richtung | Frequenz | Inhalt |
|---|---|---|---|
| `hello` | Client → Server | einmalig | Token, Rolle (`recorder`/`overlay`), Version |
| `inputs` | Recorder → Server → Overlays | Abtastung 30 Hz, gebündelt 10×/s (je 3 Samples) | Lenkwinkel, Gas, Bremse, Kupplung, Speed, Gear |
| `live` | Recorder → … | ~2 Hz | FuelLevel, Lap, LapDistPct, Session-Zeit, OnPitRoad |
| `lap` | Recorder → … | pro Runde | Rundenzeit, Fuel-Verbrauch der Runde |
| `tyres` | Recorder → … | bei Änderung (Boxenstopp) | Temp. I/M/A und Verschleiß je Reifen, Runde der Messung |
| `session` | Recorder → … | bei Änderung | Strecke, Auto, Session-Typ, Fahrerliste des Teams |
| `driver` | Server → Overlays | bei Wechsel | aktiver Fahrer, Zeitpunkt |
| `snapshot` | Server → Overlay | beim Verbinden | letzter bekannter Zustand |

Bandbreite: Inputs 10 Pakete/s × ~120 Byte + Rest ≈ 1,5–2 KB/s pro Team – vernachlässigbar. Ende-zu-Ende-Latenz über den Relay ~50–150 ms; für eine Input-Anzeige ausreichend. Das Overlay interpoliert/puffert ~100 ms, damit die Trace flüssig läuft.

## Technologie-Empfehlung

| Teil | Empfehlung | Begründung |
|---|---|---|
| Sprache | **TypeScript** durchgängig | geteilte Protokoll-Typen in einem Monorepo (`packages/protocol`) |
| Recorder | Node + `irsdk-node`, als **Tray-App (Electron ohne sichtbares Fenster oder Tauri-Sidecar)** | Shared-Memory-Zugriff erprobt; Alternative bei Ressourcenproblemen: C#/.NET mit IRSDKSharper |
| Overlay-UI | **React-Web-App**, lokal ausgeliefert, Canvas für die Input-Trace | eine UI für Desktop und VR |
| Overlay Desktop | **Electron** (`transparent`, `alwaysOnTop: 'screen-saver'`, `setIgnoreMouseEvents`) | bewährter Stack für iRacing-Overlays |
| Overlay VR | **Eigenes SteamVR-Overlay** (OpenVR `IVROverlay` + D3D11-Textur per koffi; Electron rendert offscreen), OpenKneeboard als Fallback | Team-Headset Bigscreen Beyond 2e = SteamVR |
| Server | Node + `ws` (bzw. uWebSockets.js), Docker | klein, zustandsarm; Hosting z.B. Fly.io/Hetzner (EU-Region wegen Latenz) |
| Persistenz | MVP: keine (In-Memory); später SQLite/Postgres für Teams/Tokens & Stint-Historie | |

Offene Entscheidung: Recorder + Overlay als **zwei Programme** (wie gewünscht) oder ein Installer mit zwei Prozessen. Empfehlung: ein Installer, zwei Prozesse – der Recorder bleibt schlank und läuft auch ohne Overlay.

## Monorepo-Struktur (Vorschlag)

```
stintview/
  apps/
    recorder/     # Tray-App, irsdk → WS
    overlay/      # Electron-Overlay
    server/       # Relay
  packages/
    protocol/     # Nachrichtentypen, (De-)Serialisierung, Versionierung
    telemetry/    # Ableitungen: Fuel/Runde, Runden übrig, Stint-Zeit
  docs/
```

## MVP-Umfang

0. **Spikes:** (a) ✅ `.ibt`-Analyse; (b) ✅ Live-Test: Oberflächentemps/Druck nicht live verfügbar; (c) ✅ SteamVR-Overlay auf der Bigscreen Beyond 2e läuft flackerfrei.
1. Server: Team anlegen/beitreten, Räume, Fan-out, Snapshot.
2. Recorder: irsdk lesen, Fahrer-Erkennung, `inputs`/`live`/`lap`/`tyres`/`session` senden, Fuel-pro-Runde-Berechnung, Reconnect.
3. Overlay: Widgets **Inputs**, **Fuel**, **Reifen**, Kopfzeile; Desktop (Electron, click-through + Edit-Modus) und VR (OpenKneeboard).
4. Testbarkeit: **Replay-Modus** für den Recorder (liest `.ibt`-Dateien oder aufgezeichnete Streams), damit ohne laufendes Rennen entwickelt werden kann.

## Später

- Strategie: Pit-Fenster, Fuel-Ziel, Stint-Planung, Fahrerwechsel-Countdown
- Gegner-Gaps / Klassenrelative
- Stint-Historie & Auswertung
- VR-Overlay, Discord-Login, Web-Dashboard

## Risiken

- **Desktop-Overlay nur im Borderless-Modus** – muss dem Team klar kommuniziert werden.
- **Reifen nicht live:** Karkasstemperatur/Verschleiß nur beim Stopp, Oberflächentemperatur/Druck gar nicht live (nur nachträglich aus der `.ibt`, Telemetrie-Logging muss beim Fahrer an sein).
- **VR:** SteamVR-Overlay hängt an der Funktionstabellen-Version `IVROverlay_028` und D3D11; Headsets ohne SteamVR über OpenKneeboard.
- **Fahrer-Erkennung** hängt von Session-YAML ab (Team-Events) – mit echten Team-Sessions und Replays testen.
- **Ressourcen während des Fahrens** – Recorder muss messbar leicht bleiben (< 1 % CPU, < 100 MB RAM Ziel).
