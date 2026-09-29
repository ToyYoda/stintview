# StintView – Setup for team members

During a team race, StintView shows you the data of the teammate who is currently driving:
steering, throttle, brake, fuel used per lap and tyres – on your monitor or in VR.

StintView is a small program that lives in the notification area of the taskbar. It sends your data *while you are in the car* and shows the data of the current driver.
StintView has nothing to do with your iRacing account, and nothing has to be enabled in iRacing.

Time needed: about 3 minutes, once.

---

## What you get from your team manager

1. The **server address**, e.g. `example.dyndns.org:8787`
2. An **invite code**, e.g. `ABCD-EFGH`

---

## Step 1: Install

1. Download **`StintView-Setup.exe`**: <https://github.com/ToyYoda/stintview/releases/latest/download/StintView-Setup.exe>
2. Run the file.
3. Windows will probably show **"Windows protected your PC"**. That's because StintView is not digitally signed (yet). Click **More info**, then **Run anyway**.

The installation needs no administrator rights and starts StintView afterwards.

## Step 2: Join the team

In the StintView window, under **Team beitreten** (join team), fill in:

- **Server-Adresse** (server address) and **Einladungscode** (invite code) from your team manager
- **Dein Name** (your name) – this is how your team sees you

Then click **Team beitreten**. Under *Status*, **Team-Server: verbunden** (connected) appears.

> The StintView app itself is currently in German only.

**Done.** You never need to set anything up again.

---

## In every team race

Nothing to do: StintView starts with Windows and runs in the notification area of the taskbar (bottom right, the red "O"; possibly hidden under the **^** arrow).

- **Click** the icon to open the StintView window with status and switches.
- **Right-click** opens the menu with the same switches and **StintView beenden** (quit).

As soon as you are in the car, your team sees your data. When you get out, StintView stops sending on its own.

### Overlay on your monitor

Switch **Overlay am Monitor** (on by default). In iRacing's graphics options, choose **borderless window** – in exclusive fullscreen the overlay is invisible.

- **Moving the displays:** click **Anzeigen verschieben** (move displays) in the StintView window (or menu), drag the displays with the mouse, then click **Fertig** (done) in the yellow banner at the top.
- Faster via hotkey: **Ctrl+Shift+O**. If another program already uses it (e.g. AMD Radeon Software), StintView takes **Ctrl+Alt+O** or **Ctrl+Shift+F9** instead – the active one is shown in the StintView window.
- Outside edit mode, all clicks go through the overlay to iRacing.

### Jumping to an incident as a spectator

When your driver gets a **yellow** (incident ahead), the overlay header shows **GELB VORAUS** (yellow ahead) with the button **Zum Unfall** (to the incident). Clicking it points the camera in *your* iRacing (chase camera "Far Chase") at the car ahead of your driver that is off track or stopped – so you can tell them on Discord what's going on. **Zurück zu …** (back to …) returns to your driver.

- Requirement: you are watching the team session in iRacing (not driving yourself). Nothing is ever changed for the driver.
- Hotkeys (also in VR): **Ctrl+Shift+J** = to the incident, **Ctrl+Shift+K** = back (fallback hotkeys are shown in the StintView window).
- If StintView finds no stopped car ahead of your driver, iRacing shows the latest incident on track.

### Overlay in VR (SteamVR headsets)

Switch **VR-Overlay (SteamVR)**. Works with anything that runs through **SteamVR** (e.g. Bigscreen Beyond, Valve Index, Vive, Pimax). StintView connects automatically as soon as SteamVR is running.

The displays appear about 80 cm in front of you, just below eye level. If they float somewhere else in the room: reset the seated position in iRacing (recenter).

Moving the displays – works with the headset on, using the keyboard:

| Keys | Effect |
|---|---|
| Ctrl+Shift+V | select the next display (yellow frame) |
| Ctrl+Shift+arrow keys | left / right / up / down |
| Ctrl+Shift+PgUp / PgDn | closer / further away |
| Ctrl+Shift+Plus / Minus | larger / smaller |
| Ctrl+Shift+H | hide / show all displays |

Meta Quest via Link/Air Link without SteamVR is not supported yet.

---

## What the displays show

- **Header:** who is driving. Green dot = data is arriving. Yellow = connecting, or data is older than 3 seconds.
- **Inputs:** steering wheel, throttle (green), brake (red) live and as a trace of the last 5 seconds.
- **Fuel (Sprit):** fuel in the tank, laps remaining, fuel used last lap / avg of 3 / avg of 5 laps. Grey bars = laps with a pit stop (not included in the averages).
- **Tyres (Reifen):** iRacing measures temperature and wear **only at a pit stop**. Shown are the measurement from the last stop and an estimate of how much tread is left now.
- **Weather (Wetter):** air and track temperature (with a trend arrow over ~10 min), clouds, precipitation, track wetness and whether rain tyres are allowed – below that the **changes** during the race with time of day (e.g. "13:29 Wolken: bedeckt → stark bewölkt"). iRacing doesn't provide a forecast to StintView.

Which displays appear on the monitor and which in VR is set in the StintView window under **Anzeigen** (one checkbox each for monitor and VR).

---

## Updates

StintView updates itself. When an update is ready, the menu shows **"Update … wird beim Beenden installiert"** (will be installed on exit) – it's in after the next restart (or after quitting StintView).

---

## Troubleshooting

| Message / problem | Solution |
|---|---|
| "Windows protected your PC" | **More info → Run anyway** (see step 1). |
| Antivirus blocks the installation | Happens occasionally with unsigned programs. Only download from the official address above and allow it in your antivirus. |
| "Server nicht erreichbar" (server not reachable) when joining | Check the address (including `:8787`). Ask your team manager whether their server is running. |
| "Unbekannter Einladungscode" (unknown invite code) | Typo in the code – ask your team manager. |
| Status: **Keine Verbindung zum Team-Server** (no connection) | Server not reachable or not started. StintView reconnects automatically. |
| Status: **server speaks protocol v…** | Your version doesn't match the server – quit and restart StintView (update), otherwise download the setup again. |
| Status: **Im Auto – Standby** | Normal during a driver change: you are shown as soon as the previous driver has left the car. If it stays that way, you are in a different session than the team. |
| Overlay invisible on the monitor | Set iRacing to borderless window. |
| Ctrl+Shift+O doesn't move anything (with AMD, their metrics overlay opens instead) | The hotkey belongs to another program. The active StintView hotkey is shown in the window – or use the **Anzeigen verschieben** button. |
| VR: **wartet auf SteamVR** (waiting for SteamVR) | Start SteamVR – StintView then connects automatically. |
| The StintView icon is missing | Start StintView from the Start menu. |

For other problems: choose **Protokolle öffnen** (open logs) in the menu and send `recorder.log` or `server.log` to your team manager.

Uninstall: Windows Settings → Apps → **StintView**. Your team credentials are kept in `%APPDATA%\StintView`.

---

## For the team manager

The team manager runs the team server – right inside StintView:

1. Install StintView (step 1).
2. In the window choose **Team anlegen (Teamchef)** (create team), keep **Team-Server auf diesem PC betreiben** (run the team server on this PC) ticked, enter team name and your name, click **Team anlegen**.
3. Windows asks whether StintView may **accept connections** – **allow** it.
4. Under *Team* you now see the **invite code** and the server. Send the invite code and your **public address** with port, e.g. `example.dyndns.org:8787`, to your team members.

So your team can reach you from the internet:

- **Router port forwarding:** forward TCP **8787** to your PC.
- Ideally set up a **DynDNS name**, so the address stays the same when your IP changes.
- Your PC with StintView must be running for the whole race – even while someone else is driving.

Team data is stored in `%APPDATA%\StintView\server\teams.json`. Back up this file – without it, everyone has to join again.

**Publishing a new version** (in the project folder): `git tag v0.2.1` and `git push origin v0.2.1`. GitHub then builds `StintView-Setup.exe` and publishes it; all installed copies of StintView update themselves.
