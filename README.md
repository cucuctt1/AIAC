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

The minimal Live2D Web SDK files required to compile and run are vendored under
`vendor/cubism` and remain governed by Live2D's license.
