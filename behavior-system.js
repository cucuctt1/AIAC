const fs = require('fs');
const path = require('path');

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

class BehaviorSystem {
  constructor(userDataPath, writeJson) {
    this.file = path.join(userDataPath, 'behavior-state.json');
    this.writeJson = writeJson;
    this.lastActivityAt = Date.now();
    this.lastPersistAt = 0;
    this.state = this.load();
  }

  load() {
    const defaults = {
      version: 1,
      inner: { energy: 0.62, curiosity: 0.55, confidence: 0.58, affection: 0.35, stress: 0.12, boredom: 0.18 },
      attention: { target: 'idle', confidence: 0.2, since: new Date().toISOString() },
      intentions: [],
      habits: {},
      today: { date: new Date().toISOString().slice(0, 10), events: [], mood: 'neutral' },
      environment: { localTime: '', sessionMinutes: 0, online: true, battery: null, charging: null },
      timeline: [],
      lastDirectorReactionAt: 0,
      updatedAt: new Date().toISOString()
    };
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...defaults, ...value, inner: { ...defaults.inner, ...(value.inner || {}) }, attention: { ...defaults.attention, ...(value.attention || {}) }, environment: { ...defaults.environment, ...(value.environment || {}) }, intentions: Array.isArray(value.intentions) ? value.intentions.slice(-8) : [], habits: value.habits || {}, today: value.today?.date === defaults.today.date ? value.today : defaults.today, timeline: Array.isArray(value.timeline) ? value.timeline.slice(-36) : [] };
    } catch { return defaults; }
  }

  persist(force = false) {
    if (!force && Date.now() - this.lastPersistAt < 60000) return;
    this.lastPersistAt = Date.now();
    this.state.updatedAt = new Date().toISOString();
    this.writeJson(this.file, this.state);
  }

  shift(changes) {
    for (const [key, amount] of Object.entries(changes)) this.state.inner[key] = clamp(this.state.inner[key] + amount);
  }

  recover(elapsedMs) {
    const amount = Math.min(0.02, elapsedMs / 36000000 * 0.018);
    const baseline = { energy: 0.58, curiosity: 0.52, confidence: 0.56, affection: this.state.inner.affection, stress: 0.12, boredom: 0.2 };
    for (const key of Object.keys(this.state.inner)) {
      const target = baseline[key];
      if (target === undefined) continue;
      this.state.inner[key] = clamp(this.state.inner[key] + Math.sign(target - this.state.inner[key]) * Math.min(Math.abs(target - this.state.inner[key]), amount));
    }
  }

  setAttention(target, confidence) {
    if (this.state.attention.target !== target) this.state.attention.since = new Date().toISOString();
    this.state.attention.target = target;
    this.state.attention.confidence = clamp(confidence);
  }

  updateEnvironment(value) {
    this.state.environment = { ...this.state.environment, ...value, localTime: new Date().toString() };
  }

  observeActivity(kind, label = '') {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.state.today.date !== today) this.state.today = { date: today, events: [], mood: 'neutral' };
    const elapsedMs = Math.max(0, now - this.lastActivityAt);
    this.lastActivityAt = now;
    this.recover(elapsedMs);
    this.setAttention(kind === 'other' ? 'ambient desktop activity' : kind, kind === 'other' ? 0.25 : 0.72);
    const last = this.state.timeline.at(-1);
    if (last?.kind === kind) {
      last.durationMs = Number(last.durationMs || 0) + elapsedMs;
      last.endedAt = new Date(now).toISOString();
      if (label) last.label = String(label).slice(0, 120);
    } else {
      this.state.timeline.push({ kind, label: String(label || '').slice(0, 120), startedAt: new Date(now).toISOString(), endedAt: new Date(now).toISOString(), durationMs: 0 });
      this.state.timeline = this.state.timeline.slice(-36);
      this.shift({ curiosity: 0.06, boredom: -0.08 });
      this.state.today.events.push({ at: new Date(now).toISOString(), type: 'activity-change', value: kind });
      this.state.today.events = this.state.today.events.slice(-12);
    }
    const date = new Date();
    const habitKey = `${date.getDay()}:${date.getHours()}:${kind}`;
    this.state.habits[habitKey] = Math.min(500, Number(this.state.habits[habitKey] || 0) + elapsedMs / 60000);
    if (kind === 'music') this.shift({ energy: 0.0018, stress: -0.0012, boredom: -0.002 });
    else if (kind === 'coding') this.shift({ curiosity: 0.0012, energy: -0.0006 });
    else if (kind === 'gaming') this.shift({ energy: 0.0012, confidence: 0.0006 });
    else this.shift({ boredom: 0.0004, energy: -0.0003 });
    this.persist();
  }

  observeInteraction(kind, intent = 'neutral') {
    const changes = { boredom: -0.1, curiosity: 0.04 };
    if (kind === 'pat') Object.assign(changes, { affection: 0.05, stress: -0.04 });
    if (kind === 'kiss') Object.assign(changes, { affection: 0.075, confidence: -0.015, stress: -0.025 });
    if (kind === 'chat') Object.assign(changes, { affection: 0.008, energy: -0.004 });
    if (['happy', 'encouraging', 'greeting'].includes(intent)) Object.assign(changes, { energy: 0.025, confidence: 0.015 });
    if (['sad', 'angry'].includes(intent)) Object.assign(changes, { stress: 0.025, energy: -0.02 });
    this.shift(changes);
    this.setAttention(kind === 'chat' ? 'conversation' : `user ${kind}`, 0.95);
    this.state.today.mood = intent;
    this.persist(true);
  }

  observeConversation(prompt, reply) {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.today.date !== today) this.state.today = { date: today, events: [], mood: 'neutral' };
    const text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (/\b(?:todo|later|next|remind|working on|trying to|need to|fix|build|finish)\b/i.test(text) && text.length > 8) {
      const item = text.slice(0, 180);
      if (!this.state.intentions.some(entry => entry.text.toLowerCase() === item.toLowerCase())) this.state.intentions.push({ text: item, createdAt: new Date().toISOString(), status: 'open' });
      this.state.intentions = this.state.intentions.slice(-8);
    }
    if (/\b(?:done|finished|fixed|solved|completed|works now|build passed)\b/i.test(text)) {
      const open = [...this.state.intentions].reverse().find(entry => entry.status === 'open');
      if (open) { open.status = 'resolved'; open.resolvedAt = new Date().toISOString(); }
      this.state.today.events.push({ at: new Date().toISOString(), type: 'accomplishment', value: text.slice(0, 120) });
      this.state.today.events = this.state.today.events.slice(-12);
    }
    this.persist(true);
  }

  timelineSummary() {
    const totals = new Map();
    for (const event of this.state.timeline.slice(-24)) totals.set(event.kind, (totals.get(event.kind) || 0) + Number(event.durationMs || 0));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([kind, ms]) => `${kind}: ${Math.max(1, Math.round(ms / 60000))} min`).join(', ') || 'no stable activity yet';
  }

  format() {
    const inner = Object.entries(this.state.inner).map(([key, value]) => `${key} ${Number(value).toFixed(2)}`).join(', ');
    const intentions = this.state.intentions.filter(item => item.status === 'open').slice(-4).map(item => item.text).join(' | ') || 'none';
    const events = this.state.today.events.slice(-5).map(event => `${event.type}: ${event.value}`).join(' | ') || 'none';
    return `COMPANION PRESENCE STATE
Inner state: ${inner}.
Attention: ${this.state.attention.target} (confidence ${this.state.attention.confidence.toFixed(2)}). This is detected or inferred context, not direct vision.
Recent activity pattern: ${this.timelineSummary()}.
Open intentions and unfinished topics: ${intentions}.
Today: mood ${this.state.today.mood}; notable events: ${events}.
Environment: ${JSON.stringify(this.state.environment)}.
Let this subtly affect initiative, expression, gaze, and wording. Distinguish known facts from detection and guesses. Never state hidden values or describe them as meters.`;
  }

  silenceRecommended() {
    const last = this.state.timeline.at(-1);
    const focused = ['coding', 'gaming'].includes(last?.kind) && Number(last?.durationMs || 0) > 10 * 60000;
    return focused && this.state.inner.stress < 0.7;
  }

  canDirect(cooldownMs) { return Date.now() - Number(this.state.lastDirectorReactionAt || 0) >= cooldownMs; }
  markDirected() { this.state.lastDirectorReactionAt = Date.now(); this.persist(true); }
  close() { this.persist(true); }
}

module.exports = { BehaviorSystem };
