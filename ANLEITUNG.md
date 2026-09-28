# StintView – Installation für Teammitglieder

StintView zeigt dir während eines Teamrennens die Daten deines Teamkollegen, der gerade fährt:
Lenkung, Gas, Bremse, Spritverbrauch pro Runde und Reifen – am Monitor oder in VR.

Dafür laufen auf deinem PC zwei Programme:

- **Recorder** – sendet deine Daten, *wenn du im Auto sitzt*. Muss bei jedem Teamrennen laufen.
- **Overlay** – zeigt die Daten des aktuellen Fahrers an.

Du brauchst **kein Git** und nichts von iRacing freizuschalten. Mit deinem iRacing-Konto hat StintView nichts zu tun.

Zeitbedarf: ca. 15 Minuten, einmalig.

---

## Was du von deinem Teamchef bekommst

1. Die Datei **`stintview.zip`**
2. Die **Server-Adresse**, z. B. `http://beispiel.dyndns.org:8787`
3. Einen **Einladungscode**, z. B. `ABCD-EFGH`

---

## Schritt 1: Node.js installieren

StintView läuft mit Node.js (kostenlos).

1. Öffne <https://nodejs.org/>.
2. Lade die Version **„LTS“** herunter (muss **22** oder neuer sein), den **Windows Installer (.msi)**.
3. Installer starten und mit **Weiter** durchklicken. Die Voreinstellungen passen. Das Häkchen bei „Tools for Native Modules“ brauchst du **nicht**.

## Schritt 2: Eingabeaufforderung öffnen

Alle weiteren Befehle tippst (oder kopierst) du in die **Eingabeaufforderung**:

- Windows-Taste drücken, **`cmd`** eintippen, **Eingabeaufforderung** öffnen.

> Bitte die *Eingabeaufforderung* verwenden, nicht PowerShell – in PowerShell blockiert Windows oft die nötigen Skripte.

Prüfen, ob Node.js da ist:

```
node --version
```

Es muss eine Zahl ab `v22` erscheinen. Wenn „Befehl nicht gefunden“ kommt: Eingabeaufforderung schließen, neu öffnen und nochmal probieren (oder PC neu starten).

## Schritt 3: pnpm installieren

pnpm lädt die Bausteine, die StintView braucht. Einmalig:

```
npm install -g pnpm@9
```

Danach prüfen:

```
pnpm --version
```

Es muss eine Zahl ab `9` erscheinen.

## Schritt 4: StintView entpacken

1. `stintview.zip` mit Rechtsklick → **Alle extrahieren…** entpacken, z. B. nach **`C:\StintView`**.
2. Prüfen: Im Ordner `C:\StintView` müssen direkt die Datei `package.json` und die Ordner `apps` und `packages` liegen.
   Falls stattdessen noch ein Unterordner `stintview` darin ist, nimm im Folgenden diesen Pfad (z. B. `C:\StintView\stintview`).

## Schritt 5: StintView einrichten

In der Eingabeaufforderung in den Ordner wechseln:

```
cd /d C:\StintView
```

Bausteine herunterladen (dauert beim ersten Mal ein paar Minuten, ca. 300 MB):

```
pnpm install
```

Am Ende sollte `Done` stehen. Gelbe Warnungen sind normal.

## Schritt 6: Dem Team beitreten

Ersetze Adresse, Code und Namen durch deine Angaben (Anführungszeichen um den Namen lassen):

```
pnpm recorder join --server http://beispiel.dyndns.org:8787 --code ABCD-EFGH --name "Max Mustermann"
```

Bei Erfolg erscheint:

```
Team "…" – you are Max Mustermann.
```

Deine Zugangsdaten werden in `%APPDATA%\StintView\config.json` gespeichert. Diese Datei nicht weitergeben – sie ist dein persönlicher Schlüssel zum Team.

**Einrichtung fertig.** Die Schritte 1–6 musst du nie wiederholen (außer bei Updates, siehe unten).

---

## Bei jedem Teamrennen

Jeweils eine Eingabeaufforderung öffnen und zuerst in den Ordner wechseln:

```
cd /d C:\StintView
```

### A) Recorder starten – immer

```
pnpm recorder run
```

Fenster offen lassen (minimieren ist ok). Die Reihenfolge mit iRacing ist egal – der Recorder wartet, bis iRacing läuft.
Sobald du im Auto sitzt, erscheint `in the car – streaming`. Wenn du aussteigst, geht er von selbst in den Leerlauf.

### B) Overlay starten – am Monitor

Einstellung in iRacing: Grafikoptionen → **randloses Fenster (Borderless)**. Im Exklusiv-Vollbild ist das Overlay unsichtbar.

In einer **zweiten** Eingabeaufforderung:

```
cd /d C:\StintView
pnpm overlay
```

- **Strg+Umschalt+O** schaltet den Bearbeiten-Modus ein/aus: Anzeigen mit der Maus verschieben, danach wieder Strg+Umschalt+O.
- Außerhalb des Bearbeiten-Modus gehen alle Klicks durch das Overlay zu iRacing.

### C) Overlay starten – in VR (SteamVR-Brillen)

Funktioniert mit allem, was über **SteamVR** läuft (z. B. Bigscreen Beyond, Valve Index, Vive, Pimax). SteamVR zuerst starten, dann in einer zweiten Eingabeaufforderung:

```
cd /d C:\StintView
pnpm vr
```

Die Anzeigen erscheinen ca. 80 cm vor dir, knapp unter Augenhöhe. Falls sie irgendwo im Raum schweben: in iRacing die Sitzposition zurücksetzen (Recenter).

Anzeigen verschieben – geht mit Brille auf der Tastatur:

| Tasten | Wirkung |
|---|---|
| Strg+Umschalt+V | nächste Anzeige auswählen (gelber Rahmen) |
| Strg+Umschalt+Pfeiltasten | nach links/rechts/oben/unten |
| Strg+Umschalt+Bild↑ / Bild↓ | näher / weiter weg |
| Strg+Umschalt+Plus / Minus | größer / kleiner |
| Strg+Umschalt+H | alle Anzeigen aus-/einblenden |

Meta Quest per Link/Air Link ohne SteamVR wird noch nicht unterstützt.

### Beenden

In der jeweiligen Eingabeaufforderung **Strg+C** drücken (oder das Fenster schließen).

---

## Was die Anzeigen zeigen

- **Kopfzeile:** wer gerade fährt. Grüner Punkt = Daten kommen an. Gelb = Verbindung wird aufgebaut oder Daten sind älter als 3 Sekunden.
- **Eingaben:** Lenkrad, Gas (grün), Bremse (rot) live und als Verlauf der letzten 5 Sekunden.
- **Sprit:** Tankinhalt, Runden übrig, Verbrauch letzte Runde / Ø 3 / Ø 5 Runden. Graue Balken = Runden mit Boxenstopp (zählen nicht zum Durchschnitt).
- **Reifen:** iRacing misst Temperatur und Verschleiß **nur beim Boxenstopp**. Angezeigt werden die Messung vom letzten Stopp und eine Schätzung, wie viel Profil jetzt noch übrig ist.

---

## Updates

Wenn dein Teamchef eine neue `stintview.zip` schickt:

1. Alten Ordner `C:\StintView` löschen und die neue ZIP genauso entpacken (Schritt 4). Deine Teamzugangsdaten bleiben erhalten, sie liegen woanders.
2. Einmal `cd /d C:\StintView` und `pnpm install` ausführen (Schritt 5).

Schritte 1–3 und 6 sind nicht nötig.

---

## Wenn etwas nicht klappt

| Meldung / Problem | Lösung |
|---|---|
| `'pnpm' ist nicht als interner oder externer Befehl …` | Eingabeaufforderung neu öffnen. Sonst Schritt 3 wiederholen. |
| `… Ausführung von Skripts auf diesem System deaktiviert` | Du bist in PowerShell – bitte die Eingabeaufforderung (`cmd`) nehmen. |
| `Not set up yet – run create-team or join first` | Schritt 6 fehlt. |
| `unknown invite code` | Code vertippt – beim Teamchef nachfragen. |
| `disconnected, retrying …` in Dauerschleife | Server nicht erreichbar: Adresse prüfen, Teamchef fragen, ob der Server läuft. |
| `server error: server speaks protocol v…` | Deine Version passt nicht zum Server – neue ZIP holen (Updates). |
| `standby: another teammate is still streaming …` | Normal beim Fahrerwechsel: du wirst angezeigt, sobald dein Vorgänger ausgestiegen ist. |
| `standby: the team is streaming another iRacing session …` | Du fährst gerade in einer anderen Session als das Teamrennen – du wirst dem Team nicht angezeigt. |
| Overlay zeigt „Nicht eingerichtet“ | Schritt 6 fehlt oder wurde unter einem anderen Windows-Benutzer ausgeführt. |
| Overlay am Monitor unsichtbar | iRacing auf randloses Fenster stellen. |
| VR: `SteamVR not available … retrying` | SteamVR starten – StintView verbindet sich dann automatisch. |

Bei anderen Problemen: Foto oder Kopie der Meldung aus der Eingabeaufforderung an den Teamchef schicken.

---

## Für den Teamchef

**ZIP erstellen** (ohne `node_modules` und ohne Zugangsdaten), im Projektordner:

```
git archive -o stintview.zip HEAD
```

Alternativ auf GitHub „Code → Download ZIP“, falls die Teammitglieder Zugriff auf das Repository haben.

**Server starten** – auf dem Server-PC in einer eigenen Eingabeaufforderung, die während des ganzen Rennens offen bleibt:

```
cd /d C:\StintView
pnpm relay
```

Es erscheint `StintView relay listening on :8787`.

**Team anlegen** – einmalig, in einer zweiten Eingabeaufforderung (der Server muss laufen):

```
cd /d C:\StintView
pnpm recorder create-team --server http://localhost:8787 --team "Teamname" --name "Dein Name"
```

Der ausgegebene Einladungscode und die öffentliche Adresse (Router-Portfreigabe TCP 8787, Windows-Firewall, am besten ein DynDNS-Name) gehen an die Teammitglieder. Die Teamdaten liegen in `%APPDATA%\StintView\server\teams.json` und bleiben bei Updates erhalten. Diese Datei sichern – ohne sie müssen alle neu beitreten.
