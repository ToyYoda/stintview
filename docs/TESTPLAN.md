# StintView – Testplan mit dem Team

Gilt ab **Version 0.5.0** (Block 4: „Unfall voraus“). Ziel: alle Funktionen einmal unter echten Bedingungen prüfen – mehrere PCs, Internet, echte iRacing-Session, Fahrerwechsel, gelbe Flaggen, VR.
Hintergrund zu jeder Funktion: [SPEC.md](SPEC.md). Installation: [ANLEITUNG.md](../ANLEITUNG.md).

Dauer: **Vorbereitung ~20 min pro Person (einmalig), Test-Session ~90 min.**

---

## 1. Rollen

| Rolle | Wer | Aufgabe |
|---|---|---|
| **H** – Host | Philipp (Teamchef) | betreibt den Team-Server in StintView, leitet den Test, sammelt Ergebnisse |
| **A** – Fahrer A | Teammitglied 1 | fährt das **Team-Auto** |
| **B** – Fahrer B | Teammitglied 2 | übernimmt das Team-Auto beim Fahrerwechsel; fährt in Block 4 ein **zweites Auto** („Unfall-Auto“) |
| **Z** – Zuschauer | wer gerade nicht fährt (oft H) | schaut die Session in iRacing zu, prüft Overlay und Kamera-Sprung |

Mindestens **3 Personen** (H/Z, A, B). H kann Z sein. Mit 4 Personen wird es entspannter.
Kommunikation während des Tests: **Discord-Sprachkanal**. Ein Protokollführer (am besten H) notiert Uhrzeiten auffälliger Ereignisse.

---

## 2. Voraussetzungen (vor dem Testtermin erledigen)

### Alle

- [ ] **StintView 0.3.0** installiert (Download: <https://toyyoda.github.io/stintview/>). Version steht oben im StintView-Fenster. Ältere Versionen verbinden sich nicht (Protokoll v3).
- [ ] Team beigetreten (Server-Adresse + Einladungscode von H).
- [ ] iRacing im **randlosen Fenstermodus** (für das Monitor-Overlay).
- [ ] Discord läuft.
- [ ] Wer VR testet: SteamVR-Headset einsatzbereit.

### Host (H)

- [ ] Router: Portweiterleitung **TCP 8787** auf den eigenen PC (UDP nicht nötig), PC mit fester interner IP.
- [ ] DynDNS-Name eingerichtet oder aktuelle öffentliche IP notiert.
- [ ] In StintView: **Team-Server auf diesem PC** an; Windows-Firewall-Abfrage wurde erlaubt.
- [ ] Einladungscode + Adresse (`name.dyndns.org:8787`) ans Team geschickt.
- [ ] iRacing: **gehostete Session** vorbereitet (siehe Abschnitt 3).

### Vortest der Verbindung (5 min, am Vortag möglich)

Ein Teammitglied tritt bei und schaut im StintView-Fenster auf den Status.

| # | Schritt | Erwartet | Ergebnis |
|---|---|---|---|
| V1 | Teammitglied: *Team beitreten* mit Adresse + Code | Status **Team-Server: verbunden** | |
| V2 | H: StintView-Menü → *Protokolle öffnen* → `server.log` | Zeile `recorder connected: <Name>` | |

Klappt V1 nicht („Server nicht erreichbar“): Portweiterleitung, Firewall, Adresse/Port prüfen – erst dann weiter.

---

## 3. iRacing-Session einrichten (H)

Eine **gehostete Session** (Hosted), z. B. auf einer kurzen Strecke mit schnellen Runden (Nürburgring GP, Spa o. ä.) – längere Strecken machen die Sprit-Tests zäh.

- Genug Startplätze für alle, **Practice-Session mit langer Dauer** (≥ 90 min).
- **Teamrennen/Fahrerwechsel** aktivieren, damit A und B dasselbe Auto teilen können (A und B müssen im iRacing-Team eingetragen sein). Geht das nicht, Block 3 (Fahrerwechsel) in einem echten Team-Event nachholen.
- Lokale Gelbphasen kommen automatisch. Optional **Full Course Cautions** an, um auch Caution zu testen.
- Gleiches Auto für alle, das Tankstopps und Reifenwechsel hat (z. B. GT3).

Alle mit StintView treten der Session bei. Wer nicht fährt, geht als **Zuschauer** in die Session (Watch/Spectate) – die Kamera-Funktion wirkt nur in der eigenen iRacing-Ansicht.

---

## 4. Testablauf

Jeder Testfall hat eine ID. In die Spalte **Ergebnis** eintragen: ✅ ok, ⚠️ geht mit Einschränkung, ❌ Fehler – plus kurze Notiz und **Uhrzeit**.

### Block 1 – Installation & Verbindung (10 min)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 1.1 | alle | StintView-Fenster öffnen (Klick auf das rote „O“ in der Taskleiste) | Version **0.3.0**, Status *Team-Server: verbunden* | |
| 1.2 | alle | iRacing-Session betreten | Status *iRacing läuft* (bzw. *nicht im Auto*) | |
| 1.3 | Neuinstallation (mind. 1 Person auf einem PC ohne Node.js) | Setup laden, SmartScreen „Trotzdem ausführen“, beitreten | StintView startet, verbindet sich; kein weiteres Programm nötig | |
| 1.4 | alle | Menü → *Anzeigen einblenden* an, *am Monitor* gewählt | Kopfzeile oben links: „Niemand im Auto“, grauer Punkt | |

### Block 2 – Ein Fahrer, alle schauen zu (20 min)

A fährt das Team-Auto, alle anderen schauen A in iRacing zu.

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 2.1 | A | ins Auto, losfahren | bei allen: Kopfzeile **A** mit grünem Punkt, Auto · Strecke; A selbst: Status *Du fährst – dein Team sieht deine Daten* | |
| 2.2 | Z | Eingaben-Anzeige beobachten | Lenkung/Gas/Bremse laufen flüssig, passen zu dem, was man im Bild sieht (Verzögerung < ~0,5 s gefühlt) | |
| 2.2b | A | Rennen mit Einführungsrunde (fliegender Start) oder stehendem Start | Sprit-Panel: keine Runde 0 bei den Balken; Ø 3/Ø 5 und „Runden übrig“ erst ab Runde 1 | |
| 2.3 | A | 3 fliegende Runden fahren | Sprit: *Letzte*, *Ø 3* gefüllt, *Runden übrig* plausibel (Tank ÷ Verbrauch) | |
| 2.4 | A | Boxenstopp **mit Tanken und 4 neuen Reifen** | Sprit: Box-Runde als **grauer Balken**, nicht im Durchschnitt, keine negativen Werte | |
| 2.5 | Z | nach dem Stopp Reifen-Anzeige | „gemessen Stopp Runde X“, Karkasstemperaturen + „Stopp xx %“, km auf dem Satz startet bei ~0 | |
| 2.6 | A | 2 weitere Runden | Reifen: geschätztes Profil sinkt langsam, km steigt | |
| 2.7 | A | kurz in die Box ohne Service (nur durchfahren) | nichts springt unerwartet | |
| 2.8 | alle | einer schließt iRacing kurz (nicht A) | bei ihm Status *iRacing nicht aktiv*, Overlay zeigt weiter A | |

### Block 3 – Fahrerwechsel (15 min)

A fährt, B übernimmt dasselbe Team-Auto.

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 3.1 | A → B | regulärer Fahrerwechsel in der Box | Overlay wechselt binnen **~5 s** auf **B**; A: Status *Nicht im Auto* | |
| 3.2 | alle | Sprit- und Reifen-Historie nach dem Wechsel | Runden und Reifenmessung von A bleiben sichtbar und laufen weiter | |
| 3.3 | B | falls B schon „im Auto“ ist, bevor A raus ist | B: Status *Im Auto – Standby*, danach automatisch *Du fährst* | |
| 3.4 | H | `server.log` | Zeilen `A is no longer active` / `B is now the active driver` in richtiger Reihenfolge | |
| 3.5 | A (nach dem Wechsel) | A verfolgt in iRacing das Team-Auto (Kamera auf dem eigenen Team-Auto), während B fährt | A's StintView: **nicht** *Du fährst*; Overlay zeigt weiter **B**; in A's `recorder.log` **kein** `[car] … in the car` | |
| 3.6 | B (fährt) | iRacing während der Fahrt schließen | Overlay: nach spätestens ~10 s *Niemand im Auto* | |

### Block 4 – Gelbe Flagge & Kamera-Sprung (20 min) – **Hauptziel von 0.3.0**

Aufbau: **A** fährt das Team-Auto. **B** fährt ein **zweites Auto** in derselben Session und ist das „Unfall-Auto“. **Z** schaut als Zuschauer zu, Kamera auf dem Team-Auto.
Absprache über Discord: B fährt ein Stück vor A her und stellt sein Auto dann **neben die Strecke** oder **bleibt auf der Strecke stehen**, ca. 300–1400 m vor A. StintView auf A's PC erkennt das und meldet **UNFALL VORAUS** (iRacing setzt dafür oft **keine** gelbe Flagge – das ist der Grund für diese Erkennung).

> In Block 4 fährt B ein eigenes Auto. StintView zeigt pro Team nur ein Auto an: weil A zuerst sendet, bleibt A angezeigt und B steht auf *Standby* – das ist gewollt (Test 4.9).

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 4.1 | B | Auto vor A neben die Strecke stellen und dort **langsam** fahren oder stehen | – | |
| 4.2 | Z | Overlay-Kopfzeile | **UNFALL VORAUS · #.. B · … m · neben der Strecke/steht** blinkt, Knopf **Zum Unfall**; verschwindet mit dem Ende der Warnung (kein Nachlauf) | |
| 4.3 | Z | **Zum Unfall** klicken | iRacing-Kamera springt auf **B** in **Far Chase**; Meldung „#.. B“; iRacing behält den Fokus (Tastatur/Maus in iRacing gehen weiter) | |
| 4.3a | B | nur kurz mit Tempo über die Tracklimits fahren | **keine** Meldung | |
| 4.3c | B | erst steht B (Meldung), dann fährt B weiter; A bleibt im Auto | Meldung verschwindet ~5 s danach (spätestens nach 6 s ohne Wiederholung); im `recorder.log` steht `[hazard] clear` | |
| 4.3b | A | nach dem Test: `recorder.log` (Protokolle öffnen) an H | Zeilen `[hazard] …` passend zu den Unfällen | |
| 4.4 | Z | Knopf **Zurück zu A** | Kamera wieder bei A, in der vorherigen Kamera | |
| 4.5 | Z | Wiederholen mit **Strg+Umschalt+J** / **Strg+Umschalt+K** (bzw. Kürzel aus dem StintView-Fenster) | gleiches Verhalten wie 4.3/4.4 | |
| 4.6 | B | diesmal **auf der Strecke stehen bleiben** (Warnblinker, sicherer Abschnitt) | 4.3 findet B mit „steht/langsam“ | |
| 4.7 | B | Auto **weit** (> 700 m) vor A abstellen | **keine** „Unfall voraus“-Meldung; J-Kürzel sucht bis 3 km bzw. zeigt iRacings letzten Unfall | |
| 4.8 | A | während der Fahrt selbst Strg+Umschalt+J drücken | **nichts** passiert an A's Kamera; Meldung „Du fährst gerade …“ | |
| 4.9 | B | Status in B's StintView-Fenster, während A fährt | *Im Auto – Standby*; Overlay aller zeigt weiter nur A (kein Hin- und Herspringen) | |
| 4.10 | Z | Z schaut eine **andere** Session (z. B. offizielles Rennen) und drückt J | Meldung „Du schaust … nicht dieselbe Session wie dein Team“ | |
| 4.11 | alle | Gefühl: Kommt man mit „Zum Unfall“ schnell genug zur richtigen Stelle, um A per Discord zu warnen? Passt der Suchbereich (3 km)? | Notiz | |

### Block 4b – Position (5 min)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 4b.1 | Z | Anzeige **Position** beobachten, während A überholt/überholt wird | Reihenfolge ändert sich sofort beim Überholen (nicht erst an der Ziellinie); P1–3 + 3 vor/hinter A | |
| 4b.2 | Z | Δ-Spalte nach einer Runde | rot/+ bei Autos, die schneller waren als A, grün/− bei langsameren; A's Zeile zeigt A's letzte Rundenzeit | |
| 4b.4 | Z | Spalte **Abstand** mit iRacings Relative (F3) vergleichen | ± ca. 0,5 s gleich; überrundete Autos als „−1 R“ (blau); unter 1 s gelb (vor A) / rot (hinter A), über 3 s grau | |
| 4b.5 | Z | Spalte **Reifen** nach einem Boxenstopp eines Gegners bzw. von A | Gegner: zählt ab Boxenausfahrt ab 0; „Box“ während er in der Boxengasse ist; A's Zeile springt nach Reifenwechsel auf 0 | |
| 4b.6 | Z | Flaggen vor den Namen mit iRacings Fahrerliste vergleichen | gleiche Länder; Fahrer ohne Land („Global“) ohne Flagge | |
| 4b.6b | alle | Positions-Panel im Rennen: Spalten Automarke, Team, iR, SR, Reifen | im Teamrennen Teamnamen wie in iRacing, in einem Rennen ohne Teams keine Spalte „Team“; Embleme passen zu den Autos (Mercedes = AMG, Dallara/Ligier als Kürzel); iRating und Lizenz („A 3.45“, Lizenzfarbe) passen zu iRacings Fahrerliste; Reifen H/W bzw. S/M wie im Auto (nach einem Wechsel auf Regenreifen W in Blau); Spalten in den Panel-Einstellungen abwählbar | |
| 4b.7 | Z | im Zweikampf von A (< 1 s) auf Duell-Zeile und Kacheln achten | Duell-Zeile oben zeigt Vorder-/Hintermann mit großem Abstand, Kachel gelb/rot; A's Zeile und Nachbarn größer | |
| 4b.9 | Z | Sprit-Panel im Rennen, unten „Bis zum Ziel“ | Runden bis zum Ziel passen zur Restzeit ÷ Rundenzeit (+ laufende Runde); „Box spätestens Runde N“ passt zu „Runden übrig“; nach dem Stopp „Reicht bis ins Ziel“ bzw. weniger Stopps | |
| 4b.8 | Z | Sprit-Panel nach einigen Runden | Liter im Balken, darüber ± zur Vorrunde (grün/rot); nach Boxenstopp-Runde keine Veränderung | |
| 4b.9 | alle | im Training/Qualifying auf das Positions-Panel schauen | Titel „Bestzeiten · …“, Reihenfolge wie iRacings Wertung (F3/Ergebnisliste), Spalten Bestzeit und Δ Runde (A's Bestzeit − seine), kein Abstand/Stint/Duell-Zeile; beim Wechsel ins Rennen wieder Reihenfolge auf der Strecke | |
| 4b.9a | alle | im Training/Qualifying Duell-Panel während A's schneller Runde | eigene Position groß, „→ Pn“ sobald die Runde besser wird, nächstes Auto und fehlende Zeit passen zu iRacings Delta-Anzeige; Boxenstopp-Panel unsichtbar, Sprit ohne „Bis zum Ziel“ | |
| 4b.3 | alle | Mehrklassen-Rennen (falls vorhanden) | nur Autos der eigenen Klasse | |

### Block 4d – Überrundungen (Mehrklassen-Rennen)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 4d.1 | Z | A fährt auf ein langsameres, überrundetes Auto auf | blaue Zeile „Nachzügler“ direkt über A's Zeile, Abstand wird kleiner, verschwindet nach dem Überholen | |
| 4d.2 | Z | ein schnelleres Auto (andere Klasse oder Führende) nähert sich A von hinten, eine Runde voraus | rote Zeile „Überrunder“ direkt unter A's Zeile | |
| 4d.3 | Z | Duell-Panel einschalten (StintView-Fenster → Anzeigen → Duell); A hat Vorder- und Hintermann in der Klasse | eine Zeile: links Hintermann (▼), Abstand, Position von A, Abstand, rechts Vordermann (▲); Abstände wie in der Duell-Zeile des Positions-Panels | |
| 4d.3b | Z | A holt über einige Runden auf den Vordermann auf (oder verliert) | Balken füllt sich beim Annähern; unter dem Abstand „Δ Runde“ mit demselben Wert wie in der Spalte Δ Runde des Positions-Panels (grün = A schneller, rot = langsamer) | |
| 4d.4 | Z | ein überrundetes Auto fährt zwischen A und seinem Vordermann (bzw. ein Überrunder zwischen A und Hintermann) | blaues (bzw. rotes) Kärtchen mit der Startnummer unter der Abstandskachel (neben „Δ Runde“) zum Vorder- (bzw. Hinter-)mann, umrandet bei anderer Klasse; verschwindet, sobald es nicht mehr dazwischen ist | |
| 4d.5 | Z | Option „Autos auf anderen Runden dazwischen“ ausschalten | keine Kärtchen mehr | |

### Block 4c – Boxenstopp-Planer (während des Rennens)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 4c.1 | Z | Anzeige **Boxenstopp** vor dem ersten Stopp | „Schätzwerte“; Boxengasse „?“, bis das erste Auto an der Box war, danach Sekundenwert | |
| 4c.2 | A | im Boxen-Menü Sprit/Reifen ändern | Tankmenge, Reifenzahl und Standzeit ändern sich innerhalb 1 s | |
| 4c.3 | Z | kurz vor dem Stopp Rückkehr-Vorhersage notieren (Autos vor/hinter uns), nach dem Stopp vergleichen | gleiche Autos, Abstände ± ca. 2 s | |
| 4c.3a | Z | Boxenstopp-Panel, wenn Überrundete oder Überrundende in der Nähe der Rückkehr sind | vor jeder Zeile die aktuelle Position (P…); Nachzügler-Zeile blau, Zeile eines Autos, das uns überrundet, rot | |
| 4c.3b | alle | recorder-Protokoll nach Sessionstart: Zeile `[pit] SeriesID …` | bei unbekannter Serie SeriesID + Seriennamen an Philipp melden (für die Regelwerk-Tabelle) | |
| 4c.3c | alle | vor dem Rennen: StintView-Fenster → Boxenstopp → **Boxengassen-Zeiten einlesen** | Fortschritt „x von y Dateien“, danach „Fertig: … Durchfahrten auf … Strecken“; zweiter Klick: „Keine neuen Dateien“ | |
| 4c.4 | Z | nach dem ersten eigenen Stopp | oben „gemessen (1 Stopp)“, Tankrate/Reifenzeit plausibel; im recorder-Protokoll `[pit] own stop: …` | |

### Block 4e – Funk (Nachrichten an den Fahrer)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 4e.1 | alle | Panel **Nachrichten** einblenden; Z zusätzlich Panel **Funk** | Z sieht die Knöpfe mit Kürzel; beim Fahrer A ist das Funk-Panel unsichtbar, auch wenn eingeschaltet | |
| 4e.2 | Z | Knopf „Box diese Runde“ klicken | bei allen „Box diese Runde“ groß in Rot mit Z's Namen, nach 10 s verschwunden; iRacing behält beim Klick den Fokus | |
| 4e.3 | Z | Kürzel Strg+Umschalt+3 drücken (während iRacing im Vordergrund ist) | „Push!“ kommt an und ersetzt die vorige Nachricht | |
| 4e.4 | Z | Reiter **Funk**: Text/Farbe ändern, eigene Nachricht hinzufügen, einmalige Nachricht senden | Funk-Panel zeigt sofort die neue Liste; einmalige Nachricht kommt an, steht danach nicht in der Liste | |
| 4e.5 | A | während der Fahrt Strg+Umschalt+1 drücken | keine Nachricht (Kürzel sind beim Fahrer aus), iRacing bekommt die Taste | |
| 4e.6 | Z | während A fährt (gern in VR) drei Nachrichten kurz hintereinander senden | bei A erscheint jede sofort und ersetzt die vorige; 10 s nach der letzten ist das Panel leer; nichts kommt später nach | |

### Block 4f – Stintplaner (vor oder nach dem Rennen, ohne iRacing möglich)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 4f.1 | alle | StintView-Fenster → Reiter **Planer** → **Rundenzeiten einlesen** | Fortschritt „x von y Dateien · n Runden“, danach „Fertig …“; darüber „… Runden auf diesem PC, alle beim Team-Server“ | |
| 4f.2 | alle | ein paar Runden in iRacing fahren (Training reicht) | Zahl der Runden im Reiter **Planer** steigt; im recorder-Protokoll `[laps] 1:58… s, … l` und `[laps] uploaded …` | |
| 4f.3 | H | **Stintplaner öffnen** | Browser öffnet die Planer-Seite, „angemeldet als H“; **Neues Rennen**: Strecke/Auto aus euren Daten wählbar, alle Mitglieder einladen, speichern | |
| 4f.4 | alle | Planer öffnen, beim Rennen Verfügbarkeit ziehen, „Stints am Stück“ einstellen | eigene Zeile änderbar, fremde nicht; andere sehen die Änderung spätestens nach 20 s | |
| 4f.5 | H | **Automatisch planen** | jeder Stint mit Fahrer + Spotter, schnellste zuerst, Grenzen eingehalten; Plan-Zeile im Raster; sonst Meldung, woran es scheitert | |
| 4f.6 | H | einen Fahrer von Hand in einen Stint setzen, in dem er keine Zeit hat; dann **ab hier neu** | Stint rot markiert „Fahrer nicht verfügbar“; „ab hier neu“ behält die Stints davor | |
| 4f.7 | H | Planer-Adresse (`http://<server>:8787/planner/`) in einem anderen Browser ohne Anmeldung öffnen | Hinweis „Bitte über StintView öffnen“, keine Daten sichtbar | |

### Block 5 – Overlay bedienen (5 min)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 5.1b | alle | mit Triple-Screens (oder zweitem Monitor): Anzeigen verschieben, ein Panel auf den linken und eins auf den rechten Monitor ziehen, Fertig, StintView neu starten | Panels lassen sich auf alle Monitore ziehen und bleiben dort; Panels auf dem Hauptmonitor bleiben, wo sie waren | |
| 5.1 | alle | StintView-Fenster → **Anzeigen verschieben** | gelbes Banner im Overlay, Anzeigen lassen sich ziehen, **Fertig** beendet | |
| 5.1c | alle | Anzeigen verschieben, gelben Griff unten rechts an einem Panel ziehen, Fertig | Panel wird größer/kleiner (50–200 %); im StintView-Fenster steht die neue Größe beim Panel; bleibt nach Neustart | |
| 5.2 | alle | Tastenkürzel zum Verschieben (steht im Fenster, z. B. Strg+Umschalt+O oder Strg+Alt+O bei AMD) | wie 5.1 | |
| 5.2b | alle | Tray-Symbol → **Tastaturkürzel …** | Fenster öffnet mit der Übersicht oben; die Kürzel dort funktionieren (z. B. Verschieben); VR-Gruppe grau, solange VR aus | |
| 5.2c | alle | StintView-Fenster → Anzeigen → **Hintergrund** auf 0 %, dann 100 %; in VR ca. 40 % (Brille auf) | Hintergrund verschwindet/wird deckend, sofort; VR: Panels halbdurchsichtig, Schrift gut lesbar | |
| 5.2d | alle | Panel „Position“ aufklappen: Größe 150 %, Spalten Stint/Flagge abwählen | Panel größer, Spalten verschwinden sofort; auch in VR | |
| 5.2e | alle | Panel „Position“ aufklappen, Spalte „Δ Runde“ am Griff ⠿ nach oben ziehen, dann „iRating“ ans Ende | rote Linie zeigt die Einfügestelle; das Panel zeigt die Spalten sofort in der neuen Reihenfolge, auch nach Neustart und in VR | |
| 5.2e | alle | Ausgabe von Monitor auf VR umschalten und zurück | Panels wandern vom Monitor in die Brille und zurück, nie an beiden Orten | |
| 5.2f | alle | Anzeigen → **Nur wenn iRacing läuft** an, iRacing (Simulator) beenden, später wieder in eine Session gehen; Monitor und VR | ohne Simulator keine Anzeigen, Status „Anzeigen warten auf iRacing“; mit Simulator erscheinen sie binnen Sekunden; 15 s nach Beenden weg; kurze Ladepausen lassen sie stehen | |
| 5.3 | alle | außerhalb des Verschiebe-Modus in iRacing klicken, wo das Overlay liegt | Klicks gehen durch zu iRacing | |
| 5.4 | alle | StintView beenden und neu starten | Anzeigen an der gespeicherten Position | |

### Block 6 – VR (10 min, wer ein SteamVR-Headset hat)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 6.1 | Z (VR) | Ausgabe *VR (SteamVR)*, iRacing in VR, zuschauen | 4 Panels ca. 80 cm vor dir, kein Flackern | |
| 6.2 | Z (VR) | Strg+Umschalt+V und Pfeiltasten / Bild↑↓ / Plus/Minus | ausgewähltes Panel gelb umrandet und verschiebbar; Position bleibt nach Neustart | |
| 6.3 | Z (VR) | bei Gelb (Block 4 wiederholen) | Kopfzeilen-Panel zeigt **GELB VORAUS** und die Kürzel statt Knöpfen; Strg+Umschalt+J/K springen | |
| 6.3b | Z (VR) | Kopf zur Seite drehen, **Strg+Umschalt+R** | aktuelle Blickrichtung wird die Mitte; iRacing-Sicht und StintView-Panels rücken nach vorn | |
| 6.4 | A (VR, falls möglich) | selbst in VR fahren | iRacing-Bildrate spürbar unverändert | |

### Block 7 – Robustheit (10 min)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 7.1 | A (fährt) | WLAN/Netzwerk 20 s trennen, dann wieder verbinden | bei Z: „Daten … s alt“ (gelber Punkt); bei A laufen die Anzeigen mit eigenen Daten weiter („Team-Server nicht erreichbar – nur Sessions auf diesem PC“); danach läuft es von selbst weiter | |
| 7.2 | H | StintView beenden und neu starten (Server kurz weg) | alle: *keine Verbindung*; A's Anzeigen zeigen solange A's eigene Daten, bei Z „Nicht im Auto – Team-Server nicht erreichbar“ → nach Neustart automatisch *verbunden*; Overlay zeigt A wieder | |
| 7.2d | Z | A fährt fürs Team, Z steigt in **derselben** Session in ein eigenes Auto (z. B. offenes Training) | Z's Anzeigen zeigen Z's Auto, Kopfzeile „Im Team fährt gerade A – hier dein eigenes Auto“; die anderen sehen weiter A; steigt A aus, übernimmt Z fürs Team und der Hinweis verschwindet; steigt Z aus, wieder A | |
| 7.2c | Z | während A im Rennen fährt, selbst in einer anderen Session fahren (z. B. Test Drive) | Z's Anzeigen zeigen Z's eigene Session („Das Team fährt eine andere Session – hier deine eigene“), die anderen sehen weiter A; nach Verlassen der Test-Session wieder A | |
| 7.2b | Z | auf einem PC ohne Team (Team verlassen oder frische Installation) selbst fahren | Anzeigen zeigen die eigene Session („Ohne Team – nur Sessions auf diesem PC“), Einrichtungsfenster startet im Reiter Team | |
| 7.3 | A | iRacing während der Fahrt beenden | Overlay: nach ~10 s niemand/idle, keine Fehlermeldungen | |
| 7.4 | alle | Task-Manager: CPU/RAM von StintView während der Fahrt | CPU gering (einstelliger %-Bereich), keine wachsenden Speicherwerte | |
| 7.5 | A | iRacing-FPS mit und ohne StintView (FPS-Anzeige in iRacing) | kein spürbarer Unterschied | |

### Block 8 – Update (später, beim nächsten Release)

| # | Wer | Schritt | Erwartet | Ergebnis |
|---|---|---|---|---|
| 8.1 | alle | nach einer neuen Version StintView beenden und starten | Menü zeigt „Update … wird beim Beenden installiert“ | |
| 8.2 | alle | erneut beenden und starten | neue Versionsnummer im Fenster, Team-Zugang und Einstellungen unverändert | |

---

## 5. Zeitplan für die Test-Session (~90 min)

| Zeit | Block |
|---|---|
| 0:00 | Discord, alle in StintView verbunden (Block 1) |
| 0:10 | Block 2 – A fährt, Sprit/Reifen inkl. Boxenstopp |
| 0:30 | Block 3 – Fahrerwechsel A → B |
| 0:45 | Block 4 – Gelb & Kamera-Sprung (A Team-Auto, B Unfall-Auto) |
| 1:05 | Block 5 + 6 – Overlay bedienen, VR |
| 1:20 | Block 7 – Robustheit |
| 1:30 | Kurze Runde: Eindrücke, was fehlt, was stört |

---

## 6. Fehler melden

Pro Auffälligkeit an H (Discord oder Chat):

1. **Test-ID** und **Uhrzeit**
2. Was habt ihr getan, was ist passiert, was war erwartet?
3. **Screenshot** (Win+Umschalt+S) des Overlays / StintView-Fensters
4. Log-Dateien: StintView-Menü → **Protokolle öffnen** → `recorder.log` (jeder) und `server.log` (nur H)

H sammelt alles in der Ergebnistabelle und gibt es zur Auswertung weiter.

### Vorlage

```
Test: 4.3   Uhrzeit: 20:41   Person: Max (Z)
Getan: Bei Gelb auf "Zum Unfall" geklickt
Passiert: Kamera sprang auf ein Auto hinter A
Erwartet: Auto von B vor A
Anhang: screenshot.png, recorder.log
```

---

## 7. Bekannte Grenzen (bitte nicht als Fehler melden)

- **Reifen:** Temperatur und Verschleiß gibt iRacing nur beim Boxenstopp heraus; Oberflächentemperatur und aktueller Druck sind live nicht verfügbar – auch wenn das Dashboard sie zeigt.
- **Ein Auto pro Team:** Fahren zwei Teammitglieder gleichzeitig verschiedene Autos, wird nur das zuerst sendende angezeigt.
- **Kamera-Sprung** nur beim Zuschauer, der dieselbe Session in iRacing schaut; nie beim Fahrer.
- **VR-Panels** sind nicht anklickbar (nur Tastenkürzel).
- **SmartScreen-Warnung** bei der Installation (Programm noch nicht signiert).
- Verbindung unverschlüsselt.
