# StintView – Hinweise für Claude

**Zuerst lesen:** [docs/SPEC.md](docs/SPEC.md) – maßgebliche Spezifikation (Anforderungen, Entscheidungen, Architektur, Protokoll, iRacing-/VR-Messergebnisse, Release-Ablauf, Fallstricke, Backlog). `docs/konzept.md` ist historisch.

- Nutzer: Philipp, Teamchef von Outcast Endurance; Kommunikation auf Deutsch.
- Bei Änderungen an Anforderungen, Architektur, Protokoll oder Release-Ablauf **SPEC.md mitpflegen** (Stand/Version oben aktualisieren).
- Pushen, Tags/Releases und andere Schritte nach außen vorher bestätigen lassen.
- Tests: `pnpm test`, `pnpm typecheck`; Website-Build `node site/build.mjs` (prüft lokale Links).
