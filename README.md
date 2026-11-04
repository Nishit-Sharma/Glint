# Glint

Glint is a macOS desktop learning companion built for the Meta AI Developer Hackathon. It is written in TypeScript with Electron 45.2.2 and React, and it builds as `Glint.app`. The npm package is still named `window-companion`.

Glint is for learning from material you already have open. You start a task and add the context yourself. Glint then turns an explanation into a small model you can test: you predict an outcome, check it against a computed result, change one assumption and look again. Tasks and their history are stored on your Mac.

## What is in the source

Each item below is implemented in this tree. The [Status](#status) section says what has been verified.

- **Tasks with explicit sources.** You can paste text, import images or PDF pages, or capture one window you select. Only what you add is used. Captured window pixels stay in memory, and imported files are saved with the task.
- **Bounded learning models.** These are computed locally from rules or tables you can see:
  - a workflow/state-rule lab (predict an end state, check it, change one rule, compare);
  - a SQL join lab (typed INNER/LEFT equality, at most 12 rows and 4 columns per table);
  - formula and arithmetic experiments built from a source, with comparisons when that source changes.

  These are teaching models, not a database engine or a general solver.
- **Model providers.** You choose one in **Settings → Connection**, and Glint never falls back to the other automatically.
  - **Meta · Muse Spark** goes through an OpenAI-compatible chat-completions client and has two profiles:
    - Meta Model API (`muse-spark-1.3`), which sends `store: false`;
    - the Baseten hackathon endpoint (Muse Spark Open).
  - **Codex · GPT-6 Luna** is a temporary option. It reuses an existing local Codex sign-in through the Codex app server, and Glint does not read or copy those credentials.

  Glint asks you to approve every model request before anything is sent.
- **Websites in your own browser.** When a task needs a website, Glint opens it in a browser installed on your Mac and drives it with Playwright. The browser must be one of the following, built on Chromium **156.0.8078.73 or later**:
  - Google Chrome for Testing
  - Google Chrome
  - Chromium
  - Helium

  Glint looks in `/Applications` and `~/Applications`. If it finds none, or only an older version, it refuses and keeps your task. It never falls back to Playwright's bundled Chromium. Helium's built-in content blocker is always on, and Glint says so. Every agent action on the page needs your approval.
- **Screen-recording protection.** By default, Glint's windows are hidden from screen recording and screenshots. **Settings → Screen & shortcut → Allow screen recording** makes them visible for the current session. The setting resets to protected each time Glint opens, and the Muse key window always stays hidden.
- **Local storage.** In development (`npm run dev`), data goes to `.runtime/` in the repository. A packaged app uses Electron's `userData` folder. To use a separate folder, set `WINDOW_COMPANION_DATA_DIR` to an absolute path.
- **Small native helpers.** `native/` contains three Swift command-line tools: window lookup at a point, PDF text extraction and document source reading. The build compiles them with `swiftc`.

## Requirements

- macOS on Apple silicon, the only platform tested. Window capture and lookup work only on macOS.
- Node.js 20.19+ or 22.12+ (the Vite 7 minimum).
- Xcode Command Line Tools, for `xcrun swiftc`.
- For website tasks, one of the browsers listed above, built on Chromium 156.0.8078.73 or later.
- Window capture needs the macOS Screen Recording permission. If it is missing, Glint shows a blocker; it does not change system settings for you.

## Build and run

```sh
npm ci            # installs the exact versions in package-lock.json
npm run build     # native helpers + CLI launcher + `tsc --noEmit` + electron-vite build
npm run dev       # start the app in development mode
```

`npm run package` builds an unsigned local app bundle, `dist/mac-arm64/Glint.app`. Its app icon and menu-bar template icon (`build/companion.icns`, `build/tray/`, `src/host/tray-image.ts`) are rendered from Glint's own character by `scripts/render-character-icon.mjs`. Nothing is installed into `/Applications`, and the bundle is not signed or notarized.

## Configuring Meta Model API / Muse

This repository contains no key. Use your own, and keep it out of Git.

1. Open **Settings → Connection**.
2. Choose **Meta · Muse Spark**.
3. Pick a profile:

   | Profile | Endpoint | Model |
   |---|---|---|
   | Meta Model API · Muse Spark | `https://api.meta.ai/v1` | `muse-spark-1.3` |
   | Baseten hackathon · Muse Spark Open | `https://inference.baseten.co/v1` | `meta-models/muse-spark-open-1026` |

4. Click **Connect** and enter the key in the key-entry window.

Glint encrypts the key with Electron `safeStorage` (backed by the macOS Keychain) and saves it in its data folder. If secure storage is unavailable, it refuses to save the key.

- **Baseten:** the key can only be entered this way.
- **Meta Model API, one session only:** you can instead set the key in the environment. An environment key overrides a saved one. Glint does not read `.env` files.

  ```sh
  META_API_KEY=<your-meta-model-api-key> npm run dev   # MODEL_API_KEY also works
  ```

**Test connection** sends one fixed synthetic prompt and checks for the fixed reply. Whether your key reaches Muse depends on your Meta or Baseten access.

## Tests

```sh
mkdir -p work/continuation/runtime   # some host tests create temporary stores here
npm test                             # Vitest unit and host tests
npm run test:e2e                     # Playwright browser specs against the Vite renderer
npm run verify -- --dry-run          # show the full serial verification plan
```

The tests make no live model requests by default. The scripts that do make live requests are not part of this repository.

## Status

Checked:

- **Build:** `npm run build` completes from a copy of this public tree, using an installed copy of the dependencies locked in `package-lock.json`.
- **Unit tests:** before this tree was cut, the full development suite for the same source passed: 4,965 passed, 0 failed, 4 skipped. `tests/browser-agent.test.ts` was not run.
- **Browser specs:** 98 of 101 passed on the first run, and the other three passed on rerun. Some extra specs outside that set still fail; those failures are known and are not new in this source.
- **Public tree:** its own test suite was not rerun separately.

Not yet verified:

- **A live Muse request.** No request to the Meta Model API or the Baseten endpoint has been verified with this build. The Muse tests use stubbed transports.
- **The packaged app on a real Mac.** End-to-end use has not been fully accepted. Visual polish and motion are still being reviewed.

## Known limitations

- macOS only, and only tested on Apple silicon. There is no Windows or Linux support.
- The app is unsigned and not notarized, so macOS Gatekeeper warns on first launch.
- The learning models are small and finite by design. Glint records your reasoning but does not grade its meaning, and it does not track whether you have seen an exercise before.
- There is no general computer control, video understanding or image segmentation.
- A few compatibility tests were left out of this public tree because their fixtures are not published. Some test-only config files still name them.
- The npm package name (`window-companion`) and the bundle id (`local.nishit.windowcompanion`) have not been renamed yet.

## Credits and licence

Nishit Sharma created Glint, including the character designs and art: `src/renderer/src/character-original/`, `bot-thumbnails/`, the app icon and the menu-bar icon. They are covered by the project licence (see `LICENSE` once it is added).

Some vendored code keeps its own terms:

- one UI component is MIT **with the Commons Clause**;
- the transition effects have their own licence.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and `src/renderer/public/licenses/`. Because of these exceptions, the repository as a whole is not under a single licence.
