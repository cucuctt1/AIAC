# Live2D AI companion

Source-only Electron application. Character models and voice packs are selected
at runtime and remain outside this repository. The only bundled media pack is
`assets/soundext`.

## Setup

```powershell
npm install
npm --prefix web_renderer install
npm run build:web
npm start
```

Open `/setting` to select a `.model3.json`, optional character voice folder,
AI provider, and MCP servers. Use `/sync_model` after selecting an unfamiliar
model to create a profile-specific emotion and motion map.

## Browser bridge

The optional Chrome extension in `chrome-extension/` sends explicitly selected
page text, bounded YouTube context, and sustained feed-scrolling signals to the
desktop companion over an authenticated loopback connection. It does not hold
the AI API key or control browser pages.

Start the companion, load `chrome-extension/` as an unpacked extension, then use
the tray menu's **Copy browser bridge key** command to pair the extension popup.
See `chrome-extension/README.md` for the full setup steps.

YouTube Mix pages expose a bounded 10-item playlist plus 5 outside suggestions
to the companion. The assistant can recommend from this list or, on an explicit
request, play an observed video in the same tab using its bound ID and title.

The minimal Live2D Web SDK files required to compile and run are vendored under
`vendor/cubism` and remain governed by Live2D's license.
