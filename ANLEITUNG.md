# StintView – Installation für Teammitglieder

StintView zeigt dir während eines Teamrennens die Daten deines Teamkollegen, der gerade fährt:
Lenkung, Gas, Bremse, Spritverbrauch pro Runde und Reifen – am Monitor oder in VR.

StintView ist ein kleines Programm, das im Infobereich der Taskleiste läuft. Es sendet deine Daten, *wenn du im Auto sitzt*, und zeigt die Daten des aktuellen Fahrers an.
Mit deinem iRacing-Konto hat StintView nichts zu tun, in iRacing musst du nichts freischalten.

Zeitbedarf: ca. 3 Minuten, einmalig.

---

## Was du von deinem Teamchef bekommst

1. Die **Server-Adresse**, z. B. `beispiel.dyndns.org:8787`
2. Einen **Einladungscode**, z. B. `ABCD-EFGH`

---

## Schritt 1: Installieren

1. **`StintView-Setup.exe`** herunterladen: <https://github.com/ToyYoda/stintview/releases/latest/download/StintView-Setup.exe>
2. Die Datei starten.
3. Windows zeigt wahrscheinlich **„Der Computer wurde durch Windows geschützt“**. Das liegt daran, dass StintView (noch) nicht digital signiert ist. Klicke auf **Weitere Informationen** und dann **Trotzdem ausführen**.

Die Installation braucht keine Administratorrechte und startet StintView danach automatisch.

## Schritt 2: Dem Team beitreten

Im StintView-Fenster unter **Team beitreten** ausfüllen:

- **Server-Adresse** und **Einladungscode** vom Teamchef
- **Dein Name** – so sieht dich dein Team

Dann **Team beitreten** klicken. Unter *Status* erscheint **Team-Server: verbunden**.

**Fertig.** Du musst nie wieder etwas einrichten.

---

## Bei jedem Teamrennen

Nichts zu tun: StintView startet mit Windows und läuft im Infobereich der Taskleiste (unten rechts, das rote „O“; ggf. unter dem Pfeil **^** versteckt).

- **Klick** auf das Symbol öffnet das StintView-Fenster mit Status und Schaltern.
- **Rechtsklick** öffnet das Menü mit denselben Schaltern und **StintView beenden**.

Sobald du im Auto sitzt, sieht dein Team deine Daten. Steigst du aus, hört StintView von selbst auf zu senden.

### Overlay am Monitor

Schalter **Overlay am Monitor** (standardmäßig an). In iRacing unter Grafikoptionen **randloses Fenster (Borderless)** einstellen – im Exklusiv-Vollbild ist das Overlay unsichtbar.

- **Zum Unfall / Zurück:** stehen als feste Knöpfe oben in der Kopfzeile; „Zurück“ ist grau, solange die Kamera bei deinem Fahrer ist. Nach einem Klick zeigt der Knopf „…“, bis iRacing den Wechsel bestätigt.
- **Anzeigen verschieben:** Knopf **Anzeigen verschieben** im StintView-Fenster (oder im Menü), dann die Anzeigen mit der Maus ziehen und im gelben Banner oben auf **Fertig** klicken.
- **Alle Tastaturkürzel:** Rechtsklick auf das StintView-Symbol → **Tastaturkürzel …** (oder unten im StintView-Fenster). Dort steht, welches Kürzel StintView auf deinem PC tatsächlich bekommen hat – ist eines von einem anderen Programm belegt (z. B. AMD Radeon Software), nimmt StintView automatisch ein Ausweich-Kürzel.
- Schneller per Tastenkürzel: **Strg+Umschalt+O**. Ist das schon von einem anderen Programm belegt (z. B. AMD Radeon Software), nimmt StintView **Strg+Alt+O** oder **Strg+Umschalt+F9** – welches aktiv ist, steht im StintView-Fenster.
- Außerhalb des Bearbeiten-Modus gehen alle Klicks durch das Overlay zu iRacing.

### Als Zuschauer zum Unfall springen

Steht bis etwa 1,5 km vor deinem Fahrer ein Auto oder schleicht es neben der Strecke, erscheint in der Kopfzeile des Overlays **UNFALL VORAUS** mit Auto, Abstand und Zustand (z. B. „#44 Name · 800 m · steht“) und dem Knopf **Zum Unfall**. Das erkennt StintView selbst auf dem PC deines Fahrers (ähnlich dem iRacing-Spotter); zusätzlich löst eine gelbe Flagge **GELB VORAUS** aus. Ein Klick schaltet die Kamera in *deinem* iRacing (Verfolgerkamera „Far Chase“) direkt auf dieses Auto – so kannst du deinem Fahrer über Discord sagen, was los ist. Mit **Zurück zu …** geht es wieder zu deinem Fahrer.

- Voraussetzung: Du schaust der Team-Session in iRacing zu (nicht selbst im Auto). Beim Fahrer wird nie etwas umgestellt.
- Tastenkürzel (auch in VR): **Strg+Umschalt+J** = zum Unfall, **Strg+Umschalt+K** = zurück (Ausweichkürzel stehen im StintView-Fenster).
- Findet StintView kein stehendes Auto vor deinem Fahrer, zeigt iRacing den letzten Unfall auf der Strecke.

### Overlay in VR (SteamVR-Brillen)

Schalter **VR-Overlay (SteamVR)**. Funktioniert mit allem, was über **SteamVR** läuft (z. B. Bigscreen Beyond, Valve Index, Vive, Pimax). StintView verbindet sich automatisch, sobald SteamVR läuft.

Die Anzeigen erscheinen ca. 80 cm vor dir, knapp unter Augenhöhe. Falls sie irgendwo im Raum schweben: in iRacing die Sitzposition zurücksetzen (Recenter).

Anzeigen verschieben – geht mit Brille auf der Tastatur:

| Tasten | Wirkung |
|---|---|
| Strg+Umschalt+V | nächste Anzeige auswählen (gelber Rahmen) |
| Strg+Umschalt+Pfeiltasten | nach links/rechts/oben/unten |
| Strg+Umschalt+Bild↑ / Bild↓ | näher / weiter weg |
| Strg+Umschalt+Plus / Minus | größer / kleiner |
| Strg+Umschalt+H | alle Anzeigen aus-/einblenden |
| Strg+Umschalt+R | SteamVR-Ausrichtung zurücksetzen: geradeaus schauen, drücken – die Blickrichtung wird die neue Mitte (auch im Menü des StintView-Symbols) |

Meta Quest per Link/Air Link ohne SteamVR wird noch nicht unterstützt.

---

## Was die Anzeigen zeigen

- **Kopfzeile:** wer gerade fährt. Grüner Punkt = Daten kommen an. Gelb = Verbindung wird aufgebaut oder Daten sind älter als 3 Sekunden.
- **Eingaben:** Lenkrad, Gas (grün), Bremse (rot) live und als Verlauf der letzten 5 Sekunden.
- **Sprit:** Tankinhalt, Runden übrig, Verbrauch letzte Runde / Ø 3 / Ø 5 Runden. Graue Balken = Runden mit Boxenstopp (zählen nicht zum Durchschnitt).
- **Reifen:** iRacing misst Temperatur und Verschleiß **nur beim Boxenstopp**. Angezeigt werden die Messung vom letzten Stopp und eine Schätzung, wie viel Profil jetzt noch übrig ist.
- **Wetter:** Luft- und Streckentemperatur (mit Trendpfeil über ~10 min), Wolken, Niederschlag, Streckenzustand und ob Regenreifen freigegeben sind – darunter die **Änderungen** im Rennen mit Uhrzeit (z. B. „13:29 Wolken: bedeckt → stark bewölkt“). Eine Vorhersage gibt iRacing an StintView nicht heraus.

- **Position:** die Reihenfolge **auf der Strecke** (laufend, nicht iRacings Position, die nur einmal pro Runde springt), bei mehreren Klassen innerhalb eurer Klasse: Platz 1–3 sowie drei Autos vor und hinter euch, mit Länderflagge vor dem Namen (wie in iRacing). Spalte **Δ** = eure letzte Runde minus seine – **rot (+)**: ihr wart langsamer, **grün (−)**: ihr wart schneller. **Abstand** = Zeit auf der Strecke zu euch in Sekunden (**+** vor euch, **−** hinter euch; ganze Runden als „+1 R“). Farben: unter 1 s **gelb** (Vordermann in Reichweite) bzw. **rot** (Hintermann dicht dran), 1–3 s weiß, darüber grau, andere Runde **blau**. **Reifen** = Alter der Reifen in Runden – bei euch exakt, bei den anderen **Runden seit dem letzten Boxenstopp** (iRacing verrät nicht, ob dort Reifen gewechselt wurden); „–“ = noch kein Stopp beobachtet, „Box“ = steht gerade in der Boxengasse. StintView zählt die Stopps bei jedem Teammitglied mit, auch beim Zuschauen – also iRacing möglichst ab Rennbeginn offen haben.
- **Boxenstopp, wenn jetzt:** wie lange ein Stopp mit den Boxen-Einstellungen im Auto dauern würde (Durchfahrt der Boxengasse + Standzeit für Sprit, Reifen, Pflicht-Reparatur) und **wo ihr danach zurückkommt**: Klassenposition, die nächsten zwei Autos vor und hinter euch (alle Klassen) mit Abstand – **rot** unter 1,5 s (Verkehr), **gelb** unter 3 s, sonst freie Strecke. Annahme: die anderen stoppen nicht gleichzeitig (Autos in der Box sind markiert). Ablauf und Tankrate bestimmt iRacings Regelwerk (Standard: erst Tanken, dann Reifen; IMSA und NEC gleichzeitig, NEC mit langsamen Zapfsäulen; DTM: GT3 gleichzeitig mit schnellem Reifenwechsel). StintView erkennt das Regelwerk meist am Klassennamen, sonst gilt Standard (angezeigt mit „?“); im StintView-Fenster unter **Boxenstopp** wählbar. Die Tankrate kommt aus iRacings Regeltabelle (Prozent des Tanks pro Sekunde je Klasse), den Reifenwechsel lernt StintView bei jedem eigenen Stopp (auch im Training) je Serie und Auto, die Boxengassen-Durchfahrt an allen Autos, die an die Box fahren (bis dahin gilt für 10 Strecken ein Wert aus unserem Telemetrie-Archiv, angezeigt als „Archiv“). **Tipp:** Im StintView-Fenster unter **Boxenstopp → Boxengassen-Zeiten einlesen** liest StintView einmalig deine alten Telemetrie-Dateien (.ibt) und kennt danach die Boxengassen aller Strecken, auf denen du schon an der Box warst – dauert einige Minuten, später nur noch neue Dateien. Alle gemessenen Werte bleiben auf deinem PC gespeichert; bis dahin stehen oben „Schätzwerte“. Kennt ihr die Werte vorher, tragt sie dort ebenfalls ein.

Welche Anzeigen am Monitor und welche in VR erscheinen, stellst du im StintView-Fenster unter **Anzeigen** ein (je ein Häkchen für Monitor und VR). Darunter regelst du unter **Hintergrund der Anzeigen** getrennt für Monitor und VR, wie durchsichtig die Anzeigen sind (0 % = durchsichtig, 100 % = deckend) – die Schrift bleibt immer voll sichtbar, die Änderung wirkt sofort.

---

## Updates

StintView sucht beim Start und danach stündlich nach Updates und lädt sie im Hintergrund. Ist eines geladen, meldet sich StintView unten rechts, und im StintView-Fenster sowie im Menü (Rechtsklick auf das Symbol) steht **„Update … installieren und neu starten“** – ein Klick, ein paar Sekunden, fertig. Wer nicht klickt, bekommt das Update beim nächsten Beenden.

Sofort nachsehen: im Menü **„Nach Updates suchen“** (oder unten im StintView-Fenster).

---

## Wenn etwas nicht klappt

| Meldung / Problem | Lösung |
|---|---|
| „Der Computer wurde durch Windows geschützt“ | **Weitere Informationen → Trotzdem ausführen** (siehe Schritt 1). |
| Virenscanner blockiert die Installation | Kommt bei nicht signierten Programmen vereinzelt vor. Datei nur von der offiziellen Adresse oben laden und im Virenscanner freigeben. |
| „Server nicht erreichbar“ beim Beitreten | Adresse prüfen (inkl. `:8787`). Teamchef fragen, ob sein Server läuft. |
| „Unbekannter Einladungscode“ | Code vertippt – beim Teamchef nachfragen. |
| Status: **Keine Verbindung zum Team-Server** | Server nicht erreichbar oder nicht gestartet. StintView verbindet sich automatisch neu. |
| Status: **server speaks protocol v…** | Deine Version passt nicht zum Server – StintView beenden und neu starten (Update), sonst Setup neu herunterladen. |
| Status: **Im Auto – Standby** | Normal beim Fahrerwechsel: du wirst angezeigt, sobald dein Vorgänger ausgestiegen ist. Bleibt es dabei, fährst du in einer anderen Session als das Team. |
| Overlay am Monitor unsichtbar | iRacing auf randloses Fenster stellen. |
| Strg+Umschalt+O verschiebt nichts (bei AMD öffnet sich stattdessen deren Leistungs-Overlay) | Das Kürzel gehört einem anderen Programm. Das aktive StintView-Kürzel steht im Fenster – oder den Knopf **Anzeigen verschieben** nutzen. |
| VR: **wartet auf SteamVR** | SteamVR starten – StintView verbindet sich dann automatisch. |
| „iRacing hat den Kamerawechsel nicht angenommen“ | iRacing läuft vermutlich **als Administrator** – dann blockiert Windows die Kamera-Steuerung. iRacing normal starten (Verknüpfung → Eigenschaften → Kompatibilität → Haken bei „Als Administrator ausführen“ entfernen) oder StintView ebenfalls als Administrator starten. |
| Das StintView-Symbol fehlt | StintView über das Startmenü starten. |

Bei anderen Problemen: im Menü **Protokolle öffnen** und die Dateien `recorder.log` bzw. `server.log` an den Teamchef schicken.

Deinstallieren: Windows-Einstellungen → Apps → **StintView**. Deine Teamzugangsdaten bleiben unter `%APPDATA%\StintView` erhalten.

---

## Für den Teamchef

Der Teamchef betreibt den Team-Server – das geht direkt in StintView:

1. StintView installieren (Schritt 1).
2. Im Fenster **Team anlegen (Teamchef)** wählen, **Team-Server auf diesem PC betreiben** angehakt lassen, Teamname und Namen eintragen, **Team anlegen**.
3. Windows fragt, ob StintView **Verbindungen annehmen** darf – **erlauben**.
4. Unter *Team* stehen jetzt der **Einladungscode** und der Server. An die Teammitglieder gehen der Einladungscode und deine **öffentliche Adresse** mit Port, z. B. `beispiel.dyndns.org:8787`.

Damit dein Team dich aus dem Internet erreicht:

- **Portfreigabe im Router:** TCP **8787** auf deinen PC weiterleiten.
- Am besten einen **DynDNS-Namen** einrichten, damit die Adresse gleich bleibt, auch wenn sich deine IP ändert.
- Dein PC mit StintView muss während des ganzen Rennens laufen – auch wenn gerade jemand anderes fährt.

Die Teamdaten liegen in `%APPDATA%\StintView\server\teams.json`. Diese Datei sichern – ohne sie müssen alle neu beitreten.

**Neue Version veröffentlichen** (im Projektordner): `git tag v0.2.1` und `git push origin v0.2.1`. GitHub baut dann `StintView-Setup.exe` und veröffentlicht sie; alle installierten StintViews aktualisieren sich selbst.
