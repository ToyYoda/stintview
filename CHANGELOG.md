# StintView – Release Notes

Alle veröffentlichten Versionen, neueste zuerst. Installer und Updates: [GitHub Releases](https://github.com/ToyYoda/stintview/releases) – die App aktualisiert sich selbst.

## 0.21.0 – 10.10.2026

- **Abstände im Duell- und Positions-Panel:** Ein Auto direkt hinter oder vor dir konnte für einen Moment mit fast einer ganzen Rundenzeit erscheinen (z. B. „über 300 s“ auf der Nordschleife), und die Reihenfolge sprang kurz – besonders an Start/Ziel. StintView verfolgt jetzt jedes Auto fortlaufend und lässt sich von kurzen Aussetzern in iRacings Rundenzähler nicht mehr täuschen. Auch der Abstand direkt nach dem Überqueren der Linie stimmt jetzt. Die Werte kommen vom PC des Fahrers – sie wirken, sobald dessen StintView 0.21 hat.
- **Monitor: Größe mit der Maus:** Beim Anzeigen verschieben hat jedes Panel unten rechts einen gelben Griff – daran ziehen macht es größer oder kleiner (50–200 %, gleiche Einstellung wie der Regler „Größe“ im Fenster).
- **VR: Recenter mit iRacing koppeln:** iRacings „Sitzposition zurücksetzen“ dreht nur die iRacing-Sicht, nicht die Panels. Im StintView-Fenster unter Anzeigen (Ausgabe VR) bei „Recenter mit iRacing koppeln“ einmal die Taste bzw. den Lenkradknopf drücken, mit dem du in iRacing zurücksetzt – ab dann richten sich die Panels bei jedem Druck mit aus. iRacing bekommt den Knopf weiterhin normal.

## 0.20.0 – 10.10.2026

- **Funk:** Nachrichten kommen beim Fahrer sofort an – vorher konnten sie sich unter Spiel-Last (besonders in VR) minutenlang stauen und nacheinander nachkommen. Eine neue Nachricht ersetzt die alte sofort, 10 s nach der letzten ist das Panel leer. Wirkt vollständig, sobald der Fahrer-PC und der PC mit dem Team-Server 0.20 haben.
- **Sprit:** Runde 0 – die Einführungsrunde beim fliegenden Start bzw. die paar Meter vom Startplatz zur Linie beim stehenden Start – wird nicht mehr angezeigt und nicht in Durchschnitt und Prognose eingerechnet.
- **Positions-Panel:** neue Spalte **Team** mit dem Teamnamen – nur in Teamrennen, sonst ausgeblendet.

## 0.19.0 – 09.10.2026

- **Positions-Panel – neue Spalten:**
  - **Automarke** als Emblem vor dem Namen (Marken ohne Emblem als Kürzel, z. B. „DAL“ für Dallara).
  - **iR** – iRating des aktuellen Fahrers (2.4k = 2400).
  - **SR** – Lizenzklasse und Safety Rating in iRacings Lizenzfarbe (z. B. „A 3.45“).
  - **Reifen** – aufgezogene Mischung: H Hard, M Medium, S Soft (rot), W Regen (blau).
- **Reihenfolge der Spalten** frei wählbar: im StintView-Fenster unter Anzeigen → Position die Spalten am Griff ⠿ an die gewünschte Stelle ziehen. Jede Spalte lässt sich weiterhin abwählen.
- Die neuen Werte kommen vom PC des Fahrers – sie erscheinen, sobald dessen StintView 0.19 hat.

## 0.18.1 – 09.10.2026

- **Mehrere Monitore / Triple-Screens:** Die Anzeigen am Monitor lassen sich jetzt auf jeden Monitor ziehen, nicht mehr nur auf den Hauptmonitor. Bisherige Positionen bleiben, wo sie waren; liegt ein Panel auf einem Monitor, der nicht mehr angeschlossen ist, wird es ins Bild geholt.
- Website: App-Bild mit aktueller Version.

## 0.18.0 – 09.10.2026

- **Wer selbst fährt, sieht immer sein eigenes Auto** – auch wenn ein Teamkollege gleichzeitig in derselben Session fährt und fürs Team sendet (z. B. zwei Fahrer im selben offenen Training). Vorher zeigten die Anzeigen des zweiten Fahrers das Auto des anderen. Die Kopfzeile sagt dann „Im Team fährt gerade … – hier dein eigenes Auto“; nach dem Aussteigen zeigen die Anzeigen wieder den Teamfahrer.

## 0.17.2 – 09.10.2026

- **Boxenstopp:** Am Monitor brach seit 0.17.1 der Text neben der Stoppdauer um und zerriss die große Sekundenzahl – behoben. „Boxengasse … + Stand …“ steht wieder in einer Zeile, darunter klein „Boxengasse inkl. Anhalten und Anfahren“.
- Website: neue Bilder aller Panels und des StintView-Fensters.

## 0.17.1 – 09.10.2026

- **Duell:** unter den Abständen steht jetzt **Δ Runde** – eure letzte Runde minus die des Gegners, derselbe Wert wie im Positions-Panel (**grün** = ihr wart schneller, **rot** = langsamer). Die bisherige Aussicht („dran in ~2 R“, „zieht weg“ …) wechselte im Rennen zu oft und ist entfallen.
- **Position:** die Spalte „Reifen“ heißt jetzt **Stint** (Runden seit dem Boxenstopp).
- **Boxenstopp:** Abbremsen zum Stellplatz und Anfahren (etwa 2–3 s) zählen jetzt auch bei Durchfahrten ohne Stopp mit, die StintView zur Messung der Boxengasse nutzt (z. B. Durchfahrtsstrafen anderer Autos) – vorher fiel die Boxengassen-Zeit dadurch etwas zu kurz aus. Korrigierte Startwerte für Oschersleben und Imola. Im Panel steht „Boxengasse inkl. Anhalten/Anfahren“.

## 0.17.0 – 09.10.2026

- **Neu: Stintplaner** – im StintView-Fenster, Reiter **Planer** → **Stintplaner öffnen**: Rennen anlegen, Teammitglieder einladen, Verfügbarkeiten eintragen und die Stints mit Fahrer und Spotter automatisch planen lassen. Die Rundenzeiten kommen aus StintView (auch ältere Runden einlesbar); geht der Plan nicht auf, steht dort, woran es liegt.
- **VR:** deutlich weniger Last für das Spiel – die Panels werden nur noch neu gezeichnet und an SteamVR geschickt, wenn sich etwas ändert (vorher bis zu 60 Bilder pro Sekunde, auch ohne neue Daten).
- **Duell:** große Abstände stehen in weißer, fetter Schrift statt grau – in VR besser lesbar.
- **Boxenstopp:** vor jedem Auto steht seine aktuelle Position in der Klasse; Autos auf einer anderen Runde sind farbig hinterlegt – **blau** = Nachzügler, die ihr überrundet, **rot** = Autos, die euch überrunden. (Position und Farben erscheinen, sobald der fahrende PC 0.17 hat.)

## 0.16.0 – 09.10.2026

- Neues Outcast-Endurance-Logo und neuer Schriftzug im Einrichtungsfenster, als App-, Tray- und Installer-Symbol und auf der Website (Kopf, Fuß, Browser-Symbol).
- Website: neue App-Screenshots; Kopfzeile passt sich bei mittleren Fensterbreiten an.

## 0.15.2 – 09.10.2026

- **„Unfall voraus“ zuverlässiger:**
  - Die Warnung blieb manchmal minutenlang stehen, obwohl der Unfall längst vorbei war – behoben.
  - Warnt erst ab etwa 700 m vor dem Fahrer (vorher 1,5 km, also viel zu früh).
  - Autos, die in langsamen Kurven nur neben die Strecke kommen, lösen nicht mehr aus (neben der Strecke zählt erst unter 50 km/h).
  - Das Banner verschwindet mit dem Ende der Warnung (vorher noch 20 s Nachlauf); das gilt auch für „Gelb voraus“.

## 0.15.1 – 08.10.2026

- Textkorrektur im Einrichtungsfenster: „Team-Server läuft auf diesem PC“.

## 0.15.0 – 08.10.2026

- Die Anzeigen funktionieren auch **ohne Team-Server**: Dann zeigen sie die eigenen Daten dieses PCs.
- Ist das Team in einer anderen iRacing-Session als du, zeigen die Anzeigen deine eigene Session statt der des Teams.

## 0.14.0 – 08.10.2026

- **Eigene Ansicht für Training und Qualifying:** offizielle Wertung mit Bestzeit und Abstand (Δ); Duell mit Hochrechnung der laufenden Runde; Boxenstopp-Panel ausgeblendet.
- Duell im Rennen gespiegelt: das Auto zum Überholen links, der Verfolger rechts.
- Duell in Training/Qualifying: Name an fester Stelle, größere Flagge, Nummer und Name.

## 0.13.2 – 06.10.2026

- Neue Option **„Nur wenn iRacing läuft“**: Monitor-Overlay bzw. VR-Panels starten erst, wenn der Simulator läuft.

## 0.13.1 – 03.10.2026

- Standardpositionen der Panels überlappen sich auf einem 1920×1080-Bildschirm nicht mehr.

## 0.13.0 – 03.10.2026

- **Alternativversion „Backseat Racer“** als zweiter Installer im selben Release: gleiche Funktionen, eigener Name, eigenes Logo und eigene Farben, eigene Einstellungen und Updates; parallel zu StintView installierbar und im selben Team nutzbar.
- Website: Testentwurf im Backseat-Racer-Design unter `/beta/`; Bilder der Funktionskarten werden nicht mehr abgeschnitten.

## 0.12.0 – 02.10.2026

- Sprit-Panel: **Sprit bis zum Ziel** im Rennen.

## 0.11.0 – 02.10.2026

- **Funk:** Der Spotter schickt dem Fahrer kurze Ansagen per Knopf oder Tastenkürzel (Strg+Umschalt+1 bis 9); bis zu 12 vorbereitete Nachrichten mit eigener Farbe, dazu freier Text.
- Neue Panels **Funk** und **Nachrichten** (zeigt die neueste Nachricht 10 s lang), neuer Reiter „Funk“ im Fenster.

## 0.10.0 – 02.10.2026

- **Neues Duell-Panel:** Vordermann und Verfolger in Fahrtrichtung, Nähe-Balken und Aussicht („eingeholt in ~N Runden“), Klassennachbarn mit Abstand, optional Autos auf anderen Runden dazwischen.

## 0.9.1 – 02.10.2026

- StintView-Fenster in Reitern: Status, Anzeigen, Boxenstopp, Team, Kürzel.
- Absturz beim Klick auf das Tray-Symbol behoben (seit 0.7.0).

## 0.9.0 – 01.10.2026

- **Englische Oberfläche** wählbar; englische Website mit englischen Screenshots.
- Positions-Panel: Bestzeiten-Rangliste in Training und Qualifying; dort ohne Reifenalter und Rundenzeit-Vergleich.

## 0.8.0 – 01.10.2026

- **Einstellungen pro Panel**; Ausgabe wahlweise Monitor oder VR.
- Positions-Panel: Überrundungen, Abstand als farbige Kachel, größere Zeilen rund ums eigene Auto, Duell-Zeile.
- Sprit-Panel: Balken mit Litern und Veränderung.

## 0.7.0 – 30.09.2026

- **Boxenstopp-Planer:** Dauer des Stopps und Rückkehr-Vorhersage (wo man wieder auf die Strecke kommt); Tankrate und Reihenfolge nach den Regeln der Serie.
- Zeitverlust in der Boxengasse: Startwerte für 10 Strecken und Import aus den eigenen .ibt-Aufzeichnungen per Knopf.
- VR: Ausrichtung zurücksetzen mit Strg+Umschalt+R (auch im Tray-Menü).

## 0.6.1 – 30.09.2026

- Transparenz des Panel-Hintergrunds einstellbar, getrennt für Monitor und VR.

## 0.6.0 – 29.09.2026

- **Positions-Panel:** Reihenfolge auf der Strecke mit Abstand (farbig), Reifenalter, Länderflaggen.
- Übersicht der Tastenkürzel im Fenster und im Tray-Menü.
- Kamera-Knöpfe „Zum Unfall“ und „Zurück“ an fester Stelle (verrutschten vorher unter dem Mauszeiger).

## 0.5.2 – 29.09.2026

- Updates mit einem Klick installieren (statt zweimal neu zu starten).
- Kamerasprung wird geprüft: Erfolg erst, wenn iRacing die Kamera wirklich gewechselt hat; Hinweis, falls iRacing als Administrator läuft.

## 0.5.1 – 29.09.2026

- Im Teamrennen wurde manchmal der falsche Fahrer als aktiv erkannt, und Teamkollegen konnten nicht zum Unfall springen – behoben.

## 0.5.0 – 29.09.2026

- **„Unfall voraus“:** StintView erkennt auf dem PC des Fahrers selbst stehende oder langsame Autos voraus (der iRacing-Spotter-Ruf ist nicht auslesbar); Zuschauer springen per Knopf direkt zu diesem Auto.

## 0.4.0 – 29.09.2026

- **Wetter-Panel:** aktuelle Werte und Veränderungen.
- Anzeigen einzeln ein- und ausschaltbar.

## 0.3.0 – 29.09.2026

- **Zuschauer-Kamera:** Bei Gelb vor dem eigenen Fahrer springt die iRacing-Kamera des Teamkollegen per Knopf zum Unfall („Far Chase“) und wieder zurück.

## 0.2.2 – 29.09.2026

- Anzeigen verschieben funktioniert auch, wenn Strg+Umschalt+O schon von einem anderen Programm belegt ist.

## 0.2.1 – 29.09.2026

- Erste veröffentlichte Version: StintView als Windows-App mit Installer und automatischen Updates – Live-Telemetrie des Teamkollegen im Auto (Lenkung, Gas, Bremse, Sprit, Reifen) als Overlay am Monitor oder in VR, Team-Server, Download-Website mit Anleitung (deutsch/englisch).
- (`v0.2.0` war nur ein Tag ohne Release, der erste Build-Lauf scheiterte.)
