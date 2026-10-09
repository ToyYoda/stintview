# StintView

Live telemetry of the team member currently driving, as an overlay on top of iRacing – for endurance teams.
Specification and design decisions: [docs/SPEC.md](docs/SPEC.md) (the original concept, [docs/konzept.md](docs/konzept.md), is historical). **For team members:** installer and manual at <https://toyyoda.github.io/stintview/> ([INSTALL.md](INSTALL.md) in English / [ANLEITUNG.md](ANLEITUNG.md) in German).

```
Driver PC ── Recorder ──ws──▶ Relay server ──ws──▶ Overlay (all team members)
```

| Part | Path | Purpose |
|---|---|---|
| Desktop app | `apps/overlay` | Electron app (tray, setup, updates); starts the recorder and relay as background processes, shows the overlay on the monitor and as SteamVR panels |
| Recorder | `apps/recorder` | reads iRacing telemetry, sends only while its own user is in the car; also a command-line tool |
| Relay | `apps/server` | team rooms, invite codes, exactly one active source per team |
| Protocol | `packages/protocol` | message types (MessagePack) |
| Logic | `packages/telemetry` | fuel per lap, tyre measurements, wear forecast, input downsampling |
| Website | `site/` | download page (de/en), built from `ANLEITUNG.md` / `INSTALL.md` |

## Development

Requirements: Node 22, pnpm 9.

```bash
pnpm install
pnpm app            # desktop app with the Vite dev server (recorder/relay are bundled first)
pnpm test
pnpm typecheck
```

The app keeps credentials, settings, VR layout and logs in `%APPDATA%\StintView`.
Use a separate profile for testing: `STINTVIEW_HOME=<folder>` redirects everything.

App structure (`apps/overlay/electron/`):

| File | Purpose |
|---|---|
| `app.cjs` | entry point: tray menu, setup window (`#/setup`), background processes, autostart, updates |
| `overlay-window.cjs` | transparent monitor overlay; move the panels via a button or the first free hotkey of `Ctrl+Shift+O`, `Ctrl+Alt+O`, `Ctrl+Shift+F9` |
| `vr.cjs`, `openvr.cjs`, `d3d11.cjs` | SteamVR panels (OpenVR + D3D11 textures via koffi, no native build) |
| `config.cjs` | credentials (`config.json`), settings (`app.json`), joining/creating a team |
| `camera.cjs` | spectator camera: buttons/hotkeys "To incident" (Ctrl+Shift+J) and "Back" (Ctrl+Shift+K) → recorder (`apps/recorder/src/spectator.ts`, iRacing broadcast `CamSwitchNum`) |

`scripts/bundle.mjs` bundles the recorder and relay with esbuild into `dist-bundles/`; the app runs them as an Electron `utilityProcess`, so users don't need Node.js.

### Installer

```bash
pnpm dist           # -> apps/overlay/release/StintView-Setup.exe (local, not published)
```

Publishing: add a `## x.y.z – DD.MM.YYYY` section to [CHANGELOG.md](CHANGELOG.md) (it becomes the release text; without it the workflow stops before publishing), then push a tag. GitHub Actions builds on Windows and creates the release (`.github/workflows/release.yml`); installed apps update themselves from it.

```bash
git tag v0.2.1
git push origin v0.2.1
```

The installer is not signed (SmartScreen warning on first start).
Locally on Windows without developer mode, electron-builder fails to unpack `winCodeSign` (macOS symlinks). Workaround: unpack the archive from `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` once with `7za x … -xr!darwin` into `winCodeSign-2.6.0`.

### Testing without iRacing

Play back an `.ibt` file like a live race (recorder as a command-line tool, uses the same credentials):

```bash
pnpm recorder replay "D:\iRacing\telemetry\file.ibt" --start 60 --speed 4 --loop
```

`--start` in minutes from the start of the file, `--speed` time-lapse factor. More commands: `pnpm recorder --help` (e.g. `join`, `create-team`, `run`). To watch the messages without an overlay: `pnpm --filter @stintview/recorder exec tsx src/dev/listen.ts`.

Run the relay on its own: `pnpm relay` (port `8787` or `PORT`, teams in `%APPDATA%\StintView\server\teams.json` or `STINTVIEW_DATA`).

Overlay in the browser (second monitor, OpenKneeboard): `pnpm app:web`, then `http://127.0.0.1:5173/`. Single widgets: `#/widget/inputs`, `#/widget/fuel`, `#/widget/tyres`, `#/widget/header`.

VR diagnostics: `STINTVIEW_VR_DUMP=<folder>` (panels as PNG, works without SteamVR), `STINTVIEW_VR_FPS=45`, `STINTVIEW_VR_STATS=1` (frames per second per panel and CPU in the log). The panel layout is stored in `%APPDATA%\StintView\vr.json` (individual panels can be switched off there with `"enabled": false`).

Remote control for tests: start with `--remote-debugging-port=9333`, then `node apps/overlay/scripts/cdp.mjs eval "<js>"`, `… drag "x1,y1,x2,y2"` or `… shot image.png` (optionally with a route, e.g. `"index.html#/"` for the overlay). Testing next to an installed StintView: set `STINTVIEW_HOME=<folder>`, then the instance has its own profile (it shows "Test instance" instead of a version number).

## Known limitations

- Tyres: iRacing provides carcass temperature and wear only during a pit stop; surface temperature and pressure not live at all. The widget shows the last measurement and estimates the current wear from the distance driven.
- VR only via SteamVR. Headsets without SteamVR (e.g. Quest via Link/Air Link): OpenKneeboard with the single-widget URLs.
- The connection to the relay is unencrypted (`ws://`).
