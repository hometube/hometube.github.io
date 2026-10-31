# HomeTube Desktop — Product Plan

**Status:** M6–M8 implemented (wizard/shell/Settings; transport/queue/add-by-URL; videos + podcasts) · **Date:** 2026-10-31 · **Builds on:** M5 (Bun server sidecar)

## 1. Problem

The desktop app is currently a *diagnostic dashboard*: server status, pairing
tokens, logs, download jobs, storage paths. That's tooling for the technical
owner, not a product for the person who just wants to press play. There is no
way to play music, browse the library, or switch users inside the app.

Meanwhile the entire feature set already exists behind the REST API —
library, playlists, downloads, users, watch state, podcast feeds. The gap is
presentation, not capability.

**North-star metric:** a non-technical household member installs the .app,
opens it, and is listening to something within 60 seconds — with zero exposure
to ports, tokens, or file paths.

## 2. Personas

| Persona | Needs | Should see |
|---------|-------|-----------|
| **Owner** (you) | runs the server, cares about health, tools, storage, logs | Advanced pane, full detail |
| **Listener** (family) | picks a face, plays music/podcasts, keeps a phone in sync | Everything else |

The current UI serves only the Owner. The redesign serves the Listener by
default and tucks the Owner tooling behind a Settings tab.

## 3. Product structure

Three surfaces, one window:

```
┌──────────────────────────────────────────────────────┐
│ [face] HomeTube          now playing…      ⚙ Settings │
├──────────┬───────────────────────────────────────────┤
│ Home     │                                           │
│ Search   │           active pane                     │
│ Playlists│                                           │
│ Podcasts │                                           │
│ Videos   │                                           │
│ Devices  │                                           │
├──────────┴───────────────────────────────────────────┤
│ ▸ transport bar (persistent, like the mobile player) │
└──────────────────────────────────────────────────────┘
```

### 3.1 First-run wizard (Owner sees it once, Listener never)

Trigger: `storage.configured == false`. Fullscreen, 3 steps, no jargon:

1. **Welcome** — icon + one sentence. One button: "Get started".
2. **Where should your library live?** — pre-selected
   `~/Music/HomeTube` ("recommended"), one alternate: "I already have a
   HomeTube folder" (folder picker; detects `db.sqlite` and says "Found your
   library with N songs — welcome back").
3. **Who's in your household?** — add faces (name + optional color/avatar
   pick from the brand gradient ramp). One face is enough; "Skip" allowed.

Then land on Home with an empty-state call-to-action: "Paste a YouTube link
to add your first song" (the link field is the same one Search uses).

No servers, ports, tokens, or pairing appear anywhere in this flow.

### 3.2 Home (the Listener's default)

- Row of **faces** (users) top-left; picking one swaps the entire library
  context (`user_id` scoping is already how the API works).
- Shelves: **Recently added**, **Your playlists**, **Continue listening**
  (items with a resume position), **Downloaded for offline**.
- Big **+ Add** action: paste URL → auto-detects video/music/playlist →
  queues download with progress (already server-side) → lands in the user's
  library. Same auto-download-on-add semantics as today.

### 3.3 Player core (the actual gap)

Desktop becomes a first-class playback surface, mirroring the mobile
player model:

- Persistent **transport bar**: artwork, title/artist, prev/play/next,
  seek bar, volume, queue popover. Survives all navigation.
- Click any song → play; click playlist → queue it. Shuffle/repeat per
  playlist (same localStorage-style persistence pattern the PWA used).
- Audio: HTML5 `<audio>` served from `GET /api/music/{id}/file` (Range +
  lazy-download already work). Video mode: same pattern as the mobile
  `[id].tsx` screen — resume from `position`, flush every 30 s, auto-watch
  at ≥95%.
- **macOS integration**: Media Session API for media keys + now-playing in
  Control Center — best-effort (WKWebView may not expose it to non-Safari
  hosts); the guaranteed path is the native **Playback** menu (⌘P play/pause,
  ⌥⌘←/→ prev/next). A Rust `now_playing`/media-key bridge stays a stretch.
- **Watch state sync** is free: desktop writes the same `position` /
  `watched_at` fields the mobile app reads.

### 3.4 Devices pane (mobile as an extension, not a separate product)

This is the "download the app and sync/switch at any time" pillar:

- **One QR, always current.** The pane auto-mints pairing tokens
  (`POST /api/desktop/pair`) and shows a live QR; when a device connects,
  it appears in a list (name, platform, last-seen — extend `/api/status`
  or a small `devices` table later).
- **Hand-off = the same library + resume state.** Because playback
  positions live on the server rows, "switch to my phone" is literally:
  open the app, press play on the same item, it continues. Make this felt:
  mobile gets a "On your Mac ▸ continue" row; desktop gets "On your phone"
  affordances for items the phone is currently holding (optional stretch).
- **Install help inline**: "Download the Android app" button (latest
  mobile-v* APK link, already fetched today), plus App Store placeholder
  text for iOS when/if it ships.
- The technical bits (token string, URL with `?token=`) stay, but as a
  collapsed "enter manually" fallback.

### 3.5 Settings tab (Owner territory)

Everything from today's dashboard moves here, organized into collapsible
sections; nothing is deleted:

- **Server** — status, port, start/stop, tools checklist
- **Downloads** — active job queue (also shown contextually next to items)
- **Storage** — data dir, size, change folder
- **Subscriptions** — feed list + "check now"
- **Advanced** — log tail, settings key/value editor (`auto_download` etc.),
  export/import `.ht` backups
- **About** — version, links

Rule of thumb: if a Listener would never tap it, it belongs here.

## 4. Architecture

No new moving parts:

- **Rust shell** stays as-is (spawn/monitor sidecar, port adoption, logging).
  Add: window sizing/state, `now_playing` command (stretch), device list
  query (stretch).
- **Sidecar/server** stays as-is. The UI talks only to `127.0.0.1:<port>`
  — the same REST API mobile uses. Gaps to add server-side (small):
  - `GET /api/playlists?kind=music&user_id=` already exists; add
    `sort=recent` to shelf queries or sort client-side
  - device presence: optional `devices` table + heartbeat on authenticated
    requests (later, only if the hand-off UX needs it)
- **UI**: Vue 3 in `desktop/src`, growing from one App.vue into
  `views/` (Wizard, Home, Search, PlaylistView, Podcasts, Videos, Devices,
  Settings) + `components/TransportBar.vue` + a Pinia `player` store.
  The retired PWA (tag `python-backend-final`, `frontend/src`) contains a
  complete working player, stores, and provider plumbing in the same
  framework — treat it as a reference implementation, port deliberately
  rather than wholesale (drop IndexedDB/local-mode; desktop is
  server-mode-only by definition).

## 5. Milestones

| | Scope | Exit criteria |
|--|-------|---------------|
| **M6** | Wizard flow + faces (user switcher) + nav shell + Settings tab (move existing dashboard in) | First run: fresh machine → face created → Home, in ≤3 screens; all today's diagnostics reachable under Settings |
| **M7** | Music player: transport bar, queue, shuffle/repeat, playlists browsing, add-by-URL flow with live progress | Paste link → audible playback without leaving the app; survives navigation; media keys work |
| **M8** | Videos + podcasts panes (resume, keep, auto-watch; podcast feeds + episodes) | Feature parity with mobile for browse/play; resume state round-trips between desktop and phone |
| **M9** | Devices pane: live QR, connected list, install link, hand-off polish | Phone joins via QR in ≤10 s; item started on desktop resumes on phone |
| **M10** | Distribution polish: signed-notarized-free ad-hoc .dmg, one-time Gatekeeper bypass documented, onboarding artwork, `desktop-v*` stable release | A non-technical friend installs and plays unassisted |

Order rationale: wizard before player (M6 reshapes the shell cheaply),
player before devices (there must be something to hand off), packaging last.

## 6. Non-goals

- **Cloud accounts / remote access** — LAN pairing remains the security
  model; beyond-LAN stays a user-side reverse-proxy/Tailscale concern.
- **Paid code signing** — ad-hoc signing + documented one-time bypass only.
- **Offline desktop mode** — the sidecar *is* local; a separate local mode
  adds two sources of truth for no desktop benefit.
- **Rewriting mobile** — it already works; it gains only small affordances
  (continue-from-Mac row, device naming).

## 7. Open questions

1. **Faces UI**: resolved M6 — initials-on-gradient avatars (brand ramp picked
   deterministically from the name); the server still stores an `image` field
   for future uploaded avatars.
2. **Single window vs native menus**: resolved M6 — standard app/edit/window
   menus with About + ⌘, → Settings; player items (play/pause/next) arrive
   with M7.
3. **Auto-start on login**: resolved M6 — LaunchAgent via
   tauri-plugin-autostart, opt-in toggle in Settings ▸ Preferences.
4. **Volume ducking / exclusive audio**: not needed for v1.
5. **Multiple desktops in one household**: same server = fine (state is
   server-side); port-adoption already prevents sidecar clashes.
