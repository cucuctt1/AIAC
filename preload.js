const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('live2d', {
  pointer: (x, y, active) => {
    const type = active ? 'pointermove' : 'pointercancel';
    document.dispatchEvent(new PointerEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      pointerType: 'mouse'
    }));
  },
  dragStart: () => ipcRenderer.send('window-drag-start'),
  dragMove: () => ipcRenderer.send('window-drag-move'),
  dragEnd: () => ipcRenderer.send('window-drag-end'),
  ready: () => ipcRenderer.send('live2d-model-ready')
});

contextBridge.exposeInMainWorld('assistant', {
  send: (prompt, preferences = {}) => ipcRenderer.send('assistant-send', { prompt, preferences }),
  pat: () => ipcRenderer.send('assistant-pat'),
  kiss: () => ipcRenderer.send('assistant-kiss'),
  exit: () => ipcRenderer.send('app-exit'),
  hide: () => ipcRenderer.send('window-hide'),
  codeComment: request => ipcRenderer.send('assistant-code-comment', request),
  mediaReaction: request => ipcRenderer.send('assistant-media-reaction', request),
  command: (command, argument = '') => ipcRenderer.invoke('assistant-command', { command, argument }),
  getAiSettings: () => ipcRenderer.invoke('assistant-settings-get'),
  hasApiKey: baseUrl => ipcRenderer.invoke('assistant-settings-key-status', baseUrl),
  saveAiSettings: settings => ipcRenderer.invoke('assistant-settings-save', settings),
  getMcpSettings: () => ipcRenderer.invoke('assistant-mcp-settings-get'),
  saveMcpSettings: settings => ipcRenderer.invoke('assistant-mcp-settings-save', settings),
  onStart: callback => ipcRenderer.on('assistant-start', () => callback()),
  onDelta: callback => ipcRenderer.on('assistant-delta', (_event, text) => callback(text)),
  onAction: callback => ipcRenderer.on('assistant-action', (_event, action) => callback(action)),
  onTool: callback => ipcRenderer.on('assistant-tool', (_event, tool) => callback(tool)),
  onOpenSettings: callback => ipcRenderer.on('open-settings', () => callback()),
  onRuntimeControls: callback => ipcRenderer.on('runtime-controls', (_event, controls) => callback(controls)),
  onUserActivity: callback => ipcRenderer.on('user-activity', (_event, activity) => callback(activity)),
  onDragReaction: callback => ipcRenderer.on('window-drag-reaction', (_event, reaction) => callback(reaction)),
  onMediaState: callback => ipcRenderer.on('media-state', (_event, state) => callback(state)),
  onBehaviorSequence: callback => ipcRenderer.on('behavior-sequence', (_event, sequence) => callback(sequence)),
  onEnd: callback => ipcRenderer.on('assistant-end', () => callback()),
  onCancelled: callback => ipcRenderer.on('assistant-cancelled', () => callback()),
  onStartup: callback => ipcRenderer.on('startup-intro', (_event, text) => callback(text)),
  onError: callback => ipcRenderer.on('assistant-error', (_event, message) => callback(message))
});

contextBridge.exposeInMainWorld('contentPacks', {
  get: () => ipcRenderer.sendSync('content-pack-get-sync'),
  chooseModel: () => ipcRenderer.invoke('content-pack-choose-model'),
  chooseSounds: () => ipcRenderer.invoke('content-pack-choose-sounds'),
  chooseEffects: () => ipcRenderer.invoke('content-pack-choose-effects'),
  createProfile: name => ipcRenderer.invoke('content-pack-profile-create', name),
  selectProfile: name => ipcRenderer.invoke('content-pack-profile-select', name),
  deleteProfile: () => ipcRenderer.invoke('content-pack-profile-delete'),
  savePersona: prompt => ipcRenderer.invoke('content-pack-profile-persona', prompt),
  reset: () => ipcRenderer.invoke('content-pack-reset')
});
