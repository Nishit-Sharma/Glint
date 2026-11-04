# Third-party notices

Glint's own code and art are by Nishit Sharma (Glint) and are covered by the project licence (see `LICENSE` once it is added). This includes the character designs, the 3D character code in `src/renderer/src/character-original/` (apart from its `vendor/` folder), `shape-assets.json`, the `bot-thumbnails/` renders, the app icon (`build/companion*`) and the menu-bar icon (`build/tray/`, `src/host/tray-image.ts`). They were made from scratch for this project.

The third-party material below is **not** covered by the project licence and keeps its own terms. The full licence texts are next to the vendored code and in `src/renderer/public/licenses/`, which the app also ships.

## Vendored source (copied into this repository)

| Path | Origin | Licence | Notes |
|---|---|---|---|
| `src/renderer/src/vendor/nexvyn/` (`AiInput.tsx`, `motion-tokens.ts`, `utils.ts`) | Nexvyn UI | **MIT, subject to the Commons Clause License Condition v1.0** (`vendor/nexvyn/LICENSE`) | The Commons Clause withholds the right to "Sell", meaning to offer for a fee a product or service whose value derives entirely or substantially from this component. The notice must be kept with any redistribution, including the Commons Clause text. Nexvyn's separately licensed `components/diagrams/**` (CC BY-NC 4.0) are **not** included. |
| `src/renderer/src/vendor/transitions/` (`ui-generation.*`, `text-image-generation.*`) | Transitions.dev, © 2026 Jakub Antalik | Transitions.dev Licence (`vendor/transitions/LICENSE.txt`; full terms at https://transitions.dev/terms.html) | Use inside products is allowed. Republishing the collection, or a substantial part of it, as a competing transitions library is not. |
| `src/renderer/src/vendor/t3code/timelineScrollTarget.ts` | pingdotgg/t3code @ `ea41701` | MIT, © 2026 T3 Tools Inc. (`vendor/t3code/LICENSE`) | Provenance is recorded in `vendor/t3code/PROVENANCE.json`. |
| `src/renderer/src/character-original/vendor/three.module.min.js`, `three.core.min.js` | three.js r180 (npm `three@0.180.0`, `build/`) | MIT, © 2010-2025 three.js authors (`LICENSE-three.txt`) | Unmodified build files. |
| `src/renderer/src/character-original/vendor/RoomEnvironment.js` | three.js r180, `examples/jsm/environments/RoomEnvironment.js` | MIT, © 2010-2025 three.js authors (`LICENSE-three.txt`) | Only the import path changed: `'three'` → `'./three.module.min.js'`. |

## npm dependencies (installed by `npm ci`, not vendored)

The dependencies are listed in `package.json` and pinned in `package-lock.json`. Every direct runtime dependency declares MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0.

The app ships licence notices for the components it bundles in its UI, in `src/renderer/public/licenses/`. They cover entities, jsdiff, marked, Tiptap, @xmldom/xmldom, three.js and uiohook-napi.

`uiohook-napi` is MIT-licensed and wraps the native `libuiohook` library, whose GPL-3.0 and LGPL-3.0 texts are shipped as `UIOHOOK-GPL-3.0.txt` and `UIOHOOK-LGPL-3.0.txt`. Anyone distributing a **built app binary** must meet that native library's terms. A source-only checkout does not contain the library.
