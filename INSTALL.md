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

StintView speaks **English and German**: it follows your Windows language, and you can switch any time with **DE / EN** at the top right of the StintView window.

In the StintView window, under **Join team**, fill in:

- **Server address** and **Invite code** from your team manager
- **Your name** – this is how your team sees you

Then click **Join team**. Under *Status*, **Team server: connected** appears.

**Done.** You never need to set anything up again.

---

## In every team race

Nothing to do: StintView starts with Windows and runs in the notification area of the taskbar (bottom right, the red "O"; possibly hidden under the **^** arrow).

- **Click** the icon to open the StintView window with the tabs **Status**, **Displays**, **Pit stop**, **Team** and **Shortcuts**.
- **Right-click** opens the menu with the same switches and **Quit StintView**.

As soon as you are in the car, your team sees your data. When you get out, StintView stops sending on its own.

### Overlay on your monitor

Switch **Show displays** on and choose **Output** „Monitor“ (default). In iRacing's graphics options, choose **borderless window** – in exclusive fullscreen the overlay is invisible.

- **Moving the displays:** click **Move displays** in the StintView window (or menu), drag the displays with the mouse, then click **Done** in the yellow banner at the top.
- **All keyboard shortcuts:** right-click the StintView icon → **Keyboard shortcuts …** (or the **Shortcuts** tab in the StintView window). It shows which shortcut StintView actually got on your PC – if one is taken by another program (e.g. AMD Radeon Software), StintView automatically uses a fallback.
- Faster via hotkey: **Ctrl+Shift+O**. If another program already uses it (e.g. AMD Radeon Software), StintView takes **Ctrl+Alt+O** or **Ctrl+Shift+F9** instead – the active one is shown in the StintView window.
- Outside edit mode, all clicks go through the overlay to iRacing.

### Jumping to an incident as a spectator

When a car up to about 1.5 km ahead of your driver is stopped or crawling off track, the overlay header shows **INCIDENT AHEAD** with car, distance and state (e.g. "#44 Name · 800 m · stopped") and the button **To incident**. StintView detects this itself on your driver's PC (similar to the iRacing spotter); a yellow flag also triggers **YELLOW AHEAD**. Clicking points the camera in *your* iRacing (chase camera "Far Chase") straight at that car – so you can tell your driver on Discord what's going on. **Back** returns to your driver.

- Requirement: you are watching the team session in iRacing (not driving yourself). Nothing is ever changed for the driver.
- Hotkeys (also in VR): **Ctrl+Shift+J** = to the incident, **Ctrl+Shift+K** = back (fallback hotkeys are shown in the StintView window).
- If StintView finds no stopped car ahead of your driver, iRacing shows the latest incident on track.

### Overlay in VR (SteamVR headsets)

Switch **Show displays** on and choose **Output** „VR (SteamVR)“ – the displays then appear only in the headset, not on the monitor. Works with anything that runs through **SteamVR** (e.g. Bigscreen Beyond, Valve Index, Vive, Pimax). StintView connects automatically as soon as SteamVR is running.

The displays appear about 80 cm in front of you, just below eye level. If they float somewhere else in the room: reset the seated position (Ctrl+Shift+R, see below).

Moving the displays – works with the headset on, using the keyboard:

| Keys | Effect |
|---|---|
| Ctrl+Shift+V | select the next display (yellow frame) |
| Ctrl+Shift+arrow keys | left / right / up / down |
| Ctrl+Shift+PgUp / PgDn | closer / further away |
| Ctrl+Shift+Plus / Minus | larger / smaller |
| Ctrl+Shift+H | hide / show all displays |
| Ctrl+Shift+R | reset SteamVR orientation: look straight ahead and press – your view direction becomes the new centre (also in the StintView icon menu) |

Meta Quest via Link/Air Link without SteamVR is not supported yet.

---

## What the displays show

- **Header:** who is driving. Green dot = data is arriving. Yellow = connecting, or data is older than 3 seconds.
- **Inputs:** steering wheel, throttle (green), brake (red) live and as a trace of the last 5 seconds.
- **Fuel:** fuel in the tank, laps left, fuel used last lap / avg of 3 / avg of 5 laps. The bars show the last 8 laps with the litres used; above each, the change to the lap before (**green** = less, **red** = more). Grey bars = laps with a pit stop (not included in the averages, no change shown).
- **Tyres:** iRacing measures temperature and wear **only at a pit stop**. Shown are the measurement from the last stop and an estimate of how much tread is left now.
- **Weather:** air and track temperature (with a trend arrow over ~10 min), clouds, precipitation, track state and whether wet tyres are allowed – below that the **changes** during the race with time of day (e.g. "13:29 Clouds: overcast → mostly cloudy"). iRacing doesn't provide a forecast to StintView.
- **Position:** in **practice and qualifying** the panel shows the ranking by **best lap** instead (title "Best laps · Practice/Qualifying"): column **Best lap** and **Gap** = their best minus yours (− = faster than you, tile highlighted within 0.3 s); tyres and Δ lap are not shown there; the duel line shows the neighbours in that ranking. In the **race**: the running order **on track** (continuous, not iRacing's position that only updates once per lap), within your class in multi-class races: P1–3 plus three cars ahead of and behind you, with a country flag before the name (as in iRacing). **Lapping:** if the car right in front of you on track is a lap (or more) down, it appears as a **blue** row "Backmarker" above yours – you are about to lap it. If the car right behind you is a lap up, it appears as a **red** row "Lapping us" below yours – it is about to lap you. All classes (gap in seconds on track). Column **Δ lap** = your last lap minus theirs – **red (+)**: you were slower, **green (−)**: you were faster. **Gap** = time on track to you in seconds (**+** ahead, **−** behind; whole laps as "+1 L"). The gap is shown as a coloured tile: under 1 s **amber** (car ahead within reach) or **red** (car behind right on you), 1–3 s white, further away grey, different lap **blue**. Your row and your direct class neighbours are larger; on top, a **duel line** shows the car in front (▲) and behind (▼) with a big gap (can be switched off in the panel settings). **Tyres** = tyre age in laps – exact for your car, for others **laps since their last pit stop** (iRacing doesn't tell whether tyres were changed); "–" = no stop seen yet, "Pit" = on pit road right now. StintView counts stops on every team member's PC, also while spectating – so keep iRacing open from the race start if possible.
- **Pit stop, if now:** how long a stop with the pit settings in the car would take (pit lane drive-through + standing time for fuel, tyres, mandatory repair) and **where you rejoin**: class position, the two nearest cars ahead and behind (all classes) with gap – **red** under 1.5 s (traffic), **amber** under 3 s, otherwise clear track. Assumes the others don't stop at the same time (cars in the pits are marked). Order and fuel rate are set by iRacing's regulations (standard: fuel first, then tyres; IMSA and NEC at once, NEC with slow pumps; DTM: GT3 at once with fast tyre changes). StintView usually recognises the regulation from the class name, otherwise standard applies (shown with "?"); selectable in the StintView window under **Pit stop**. The fuel rate comes from iRacing's rule table (percent of the tank per second per class), tyre change time is learned at every own stop (practice too) per series and car, and the pit lane drive-through from every car that pits (until then, 10 tracks use a value from our telemetry archive, shown as "(archive)"). **Tip:** in the StintView window, **Pit stop → Read pit lane times** reads your old telemetry files (.ibt) once and then knows the pit lanes of every track where you have pitted – takes a few minutes, later only new files. All measured values stay stored on your PC; until then the panel says "estimates". If you know the values beforehand, enter them there too.

In the StintView window under **Displays**: **Background** sets how transparent all panels are (0 % = transparent, 100 % = opaque; text stays fully visible). Below, every panel has a checkbox (shown or not); clicking its name opens its settings: **Size** (50–200 %) and, for the Position panel, which **columns** are shown, the **duel line** and whether **lapping** cars are shown. Everything applies immediately.

---

## Updates

StintView checks for updates at start and hourly, and downloads them in the background. Once one is ready, StintView pops up a notification, and both the StintView window and the menu (right-click the icon) show **"Install update … and restart"** – one click, a few seconds, done. If you don't click, the update is installed on the next exit.

Check right away: **"Check for updates"** in the menu or at the bottom of the StintView window.

---

## Troubleshooting

| Message / problem | Solution |
|---|---|
| "Windows protected your PC" | **More info → Run anyway** (see step 1). |
| Antivirus blocks the installation | Happens occasionally with unsigned programs. Only download from the official address above and allow it in your antivirus. |
| "Server not reachable" when joining | Check the address (including `:8787`). Ask your team manager whether their server is running. |
| "Unknown invite code" | Typo in the code – ask your team manager. |
| Status: **No connection to the team server** | Server not reachable or not started. StintView reconnects automatically. |
| Status: **server speaks protocol v…** | Your version doesn't match the server – quit and restart StintView (update), otherwise download the setup again. |
| Status: **In the car – standby** | Normal during a driver change: you are shown as soon as the previous driver has left the car. If it stays that way, you are in a different session than the team. |
| Overlay invisible on the monitor | Set iRacing to borderless window. |
| Ctrl+Shift+O doesn't move anything (with AMD, their metrics overlay opens instead) | The hotkey belongs to another program. The active StintView hotkey is shown in the window – or use the **Move displays** button. |
| VR: **waiting for SteamVR** | Start SteamVR – StintView then connects automatically. |
| "iRacing didn't accept the camera switch" | iRacing probably runs **as administrator** – Windows then blocks the camera control. Start iRacing normally (shortcut → Properties → Compatibility → untick "Run as administrator") or run StintView as administrator too. |
| The StintView icon is missing | Start StintView from the Start menu. |

For other problems: choose **Open logs** in the menu and send `recorder.log` or `server.log` to your team manager.

Uninstall: Windows Settings → Apps → **StintView**. Your team credentials are kept in `%APPDATA%\StintView`.

---

## For the team manager

The team manager runs the team server – right inside StintView:

1. Install StintView (step 1).
2. In the window choose **Create team (team manager)**, keep **Run the team server on this PC** ticked, enter team name and your name, click **Create team**.
3. Windows asks whether StintView may **accept connections** – **allow** it.
4. Under *Team* you now see the **invite code** and the server. Send the invite code and your **public address** with port, e.g. `example.dyndns.org:8787`, to your team members.

So your team can reach you from the internet:

- **Router port forwarding:** forward TCP **8787** to your PC.
- Ideally set up a **DynDNS name**, so the address stays the same when your IP changes.
- Your PC with StintView must be running for the whole race – even while someone else is driving.

Team data is stored in `%APPDATA%\StintView\server\teams.json`. Back up this file – without it, everyone has to join again.

**Publishing a new version** (in the project folder): `git tag v0.2.1` and `git push origin v0.2.1`. GitHub then builds `StintView-Setup.exe` and publishes it; all installed copies of StintView update themselves.
