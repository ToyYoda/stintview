# StintView – Setup for team members

During a team race, StintView shows you the data of the teammate who is currently driving:
steering, throttle, brake, fuel used per lap and tyres – on your monitor or in VR.

Two programs run on your PC for this:

- **Recorder** – sends your data *while you are in the car*. Must be running in every team race.
- **Overlay** – shows the data of the current driver.

You do **not need Git**, and nothing has to be enabled in iRacing. StintView has nothing to do with your iRacing account.

Time needed: about 15 minutes, once.

---

## What you get from your team manager

1. The file **`stintview.zip`**
2. The **server address**, e.g. `http://example.dyndns.org:8787`
3. An **invite code**, e.g. `ABCD-EFGH`

---

## Step 1: Install Node.js

StintView runs on Node.js (free).

1. Open <https://nodejs.org/>.
2. Download the **"LTS"** version (must be **22** or newer), the **Windows Installer (.msi)**.
3. Run the installer and click **Next** through it. The defaults are fine. You do **not** need the "Tools for Native Modules" checkbox.

## Step 2: Open the Command Prompt

Type (or paste) all further commands into the **Command Prompt**:

- Press the Windows key, type **`cmd`**, open **Command Prompt**.

> Please use the *Command Prompt*, not PowerShell – PowerShell often blocks the scripts that are needed.

Check that Node.js is there:

```
node --version
```

A version of `v22` or higher must appear. If you get "not recognized": close the Command Prompt, open it again and retry (or restart the PC).

## Step 3: Install pnpm

pnpm downloads the building blocks StintView needs. Once:

```
npm install -g pnpm@9
```

Then check:

```
pnpm --version
```

A version of `9` or higher must appear.

## Step 4: Unpack StintView

1. Right-click `stintview.zip` → **Extract All…**, e.g. to **`C:\StintView`**.
2. Check: the folder `C:\StintView` must directly contain the file `package.json` and the folders `apps` and `packages`.
   If there is an extra subfolder `stintview` instead, use that path from here on (e.g. `C:\StintView\stintview`).

## Step 5: Set up StintView

In the Command Prompt, change to the folder:

```
cd /d C:\StintView
```

Download the building blocks (takes a few minutes the first time, about 300 MB):

```
pnpm install
```

It should end with `Done`. Yellow warnings are normal.

## Step 6: Join the team

Replace address, code and name with your details (keep the quotes around the name):

```
pnpm recorder join --server http://example.dyndns.org:8787 --code ABCD-EFGH --name "Jane Doe"
```

On success you see:

```
Team "…" – you are Jane Doe.
```

Your credentials are stored in `%APPDATA%\StintView\config.json`. Do not share this file – it is your personal key to the team.

**Setup done.** You never need to repeat steps 1–6 (except for updates, see below).

---

## In every team race

Open a Command Prompt each time and change to the folder first:

```
cd /d C:\StintView
```

### A) Start the recorder – always

```
pnpm recorder run
```

Keep the window open (minimising is fine). The order relative to iRacing does not matter – the recorder waits until iRacing is running.
As soon as you are in the car, `in the car – streaming` appears. When you get out, it goes idle on its own.

### B) Start the overlay – on your monitor

iRacing setting: graphics options → **borderless window**. In exclusive fullscreen the overlay is invisible.

In a **second** Command Prompt:

```
cd /d C:\StintView
pnpm overlay
```

- **Ctrl+Shift+O** toggles edit mode: drag the displays with the mouse, then press Ctrl+Shift+O again.
- Outside edit mode, all clicks go through the overlay to iRacing.

### C) Start the overlay – in VR (SteamVR headsets)

Works with anything that runs through **SteamVR** (e.g. Bigscreen Beyond, Valve Index, Vive, Pimax). Start SteamVR first, then in a second Command Prompt:

```
cd /d C:\StintView
pnpm vr
```

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

### Stopping

Press **Ctrl+C** in the respective Command Prompt (or close the window).

---

## What the displays show

- **Header:** who is driving. Green dot = data is arriving. Yellow = connecting, or data is older than 3 seconds.
- **Inputs:** steering wheel, throttle (green), brake (red) live and as a trace of the last 5 seconds.
- **Fuel:** fuel in the tank, laps remaining, fuel used last lap / avg of 3 / avg of 5 laps. Grey bars = laps with a pit stop (not included in the averages).
- **Tyres:** iRacing measures temperature and wear **only at a pit stop**. Shown are the measurement from the last stop and an estimate of how much tread is left now.

---

## Updates

When your team manager sends a new `stintview.zip`:

1. Delete the old folder `C:\StintView` and unpack the new ZIP the same way (step 4). Your team credentials are kept, they are stored elsewhere.
2. Run `cd /d C:\StintView` and `pnpm install` once (step 5).

Steps 1–3 and 6 are not needed.

---

## Troubleshooting

| Message / problem | Solution |
|---|---|
| `'pnpm' is not recognized as an internal or external command …` | Reopen the Command Prompt. Otherwise repeat step 3. |
| `… running scripts is disabled on this system` | You are in PowerShell – please use the Command Prompt (`cmd`). |
| `Not set up yet – run create-team or join first` | Step 6 is missing. |
| `unknown invite code` | Typo in the code – ask your team manager. |
| `disconnected, retrying …` over and over | Server not reachable: check the address, ask your team manager whether the server is running. |
| `server error: server speaks protocol v…` | Your version does not match the server – get the new ZIP (updates). |
| `standby: another teammate is still streaming …` | Normal during a driver change: you are shown as soon as the previous driver has left the car. |
| `standby: the team is streaming another iRacing session …` | You are driving in a different session than the team race – you are not shown to the team. |
| Overlay says "Nicht eingerichtet" (not set up) | Step 6 is missing or was run under a different Windows user. |
| Overlay invisible on the monitor | Set iRacing to borderless window. |
| VR: `SteamVR not available … retrying` | Start SteamVR – StintView then connects automatically. |

For other problems: send a photo or copy of the message from the Command Prompt to your team manager.

---

## For the team manager

**Create the ZIP** (without `node_modules` and without credentials), in the project folder:

```
git archive -o stintview.zip HEAD
```

Alternatively "Code → Download ZIP" on GitHub, if team members have access to the repository.

**Start the server** – on the server PC in its own Command Prompt that stays open for the whole race:

```
cd /d C:\StintView
pnpm relay
```

`StintView relay listening on :8787` appears.

**Create the team** – once, in a second Command Prompt (the server must be running):

```
cd /d C:\StintView
pnpm recorder create-team --server http://localhost:8787 --team "Team name" --name "Your name"
```

The invite code shown and the public address (router port forwarding TCP 8787, Windows Firewall, ideally a DynDNS name) go to the team members. Team data is stored in `%APPDATA%\StintView\server\teams.json` and survives updates. Back up this file – without it, everyone has to join again.
