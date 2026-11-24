# app-ui

Design mock for komon-portal. Reference only: the implementation under `src/app/web` reproduces these screens.

- Canvas: https://claude.ai/artifact/6J6jgSdS6dzTWTZXHKRWx6 (Claude Design, private to the owner)
- Design system: VELIORA OFFICE (`veliora-office` in the design systems catalog). Tokens are in `ds/veliora-office/tokens.json`.
- Files: one `*.dc.html` per screen, `canvas.json` is the canvas index. `Sidebar.dc.html` is the shared office menu.

## Screens

| File | Screen |
|---|---|
| Main.dc.html | Office - Dashboard |
| Intake.dc.html | Office - Intake |
| Review.dc.html | Office - Review |
| Staged.dc.html | Office - Staged |
| Shelf.dc.html | Office - Shelf |
| Cases.dc.html | Office - Cases |
| Clients.dc.html | Office - Clients |
| Settings.dc.html | Office - Settings |
| SignIn.dc.html | Common - Sign in |
| ClientHome.dc.html | Client - Home |
| ClientDocuments.dc.html | Client - Documents |
| ClientSendFiles.dc.html | Client - Send Files |

## State colours added on top of the design system

The design system has no state colours, so these four are added (instructions.md 1.11). Each is always paired with a word and an icon.

| State | Background | Text |
|---|---|---|
| Published | #d9f2df | #14532d |
| Staged | #e3eefc | #0d47a1 |
| Needs review | #fff0e0 | #8a4300 |
| Withdrawn / expired | #fde7e7 | #a31515 |

All names, codes and dates in the mock are sample data.
