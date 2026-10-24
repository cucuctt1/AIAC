import { LAppDelegate } from './lappdelegate';

type AssistantAction = {
  intent?: string;
  intensity?: number;
  playSound?: boolean;
  phase?: 'thinking' | 'speaking';
};

type CatalogAsset = {
  id: string;
  group?: string;
  index?: number;
  category: string;
  level?: number | null;
  file: string;
};

type ActionCatalog = {
  expressions: CatalogAsset[];
  motions: CatalogAsset[];
  sounds: CatalogAsset[];
  effects: CatalogAsset[];
  effectMap: Record<string, string[]>;
  intentMap: Record<string, {
    motionCategories: string[];
    expressionCategories: string[];
    soundCategories: string[];
    motionIds?: string[];
    expressionIds?: string[];
  }>;
};

let catalog: ActionCatalog = null;
let pendingMotion: CatalogAsset = null;
let pendingSound: CatalogAsset = null;
let pendingEffect: CatalogAsset = null;
let playSound = false;
let speaking = false;
let thinking = false;
let queuedAction: AssistantAction = null;
let resetTimer = 0;
let idleTimer = 0;
let patTimer = 0;
let soundVolume = 0.8;
let voiceVolume = 1;
let effectVolume = 0.75;
let soundBalance = 0;
let audioContext: AudioContext = null;
let activeGain: GainNode = null;
let activePanner: StereoPannerNode = null;
let activeAnalyser: AnalyserNode = null;
let meterFrame = 0;
let idleAnimationsEnabled = true;
let reactionsPaused = false;
let activeIntent = 'neutral';
let activeIntensity = 0.5;
let activeAudio: HTMLAudioElement = null;
type QueuedAudio = { asset: CatalogAsset; kind: 'voice' | 'effect' };
let queuedSounds: QueuedAudio[] = [];
let activeAudioKind: 'voice' | 'effect' = 'voice';
let usedSounds = new Set<string>();
let typingThinking = false;
let speakingStartedAt = 0;
let scheduledSentenceStarts = new Set<number>();
let emotionTimers: number[] = [];
let currentExpressionId = '';
let danceTimer = 0;
let danceUntil = 0;
let danceStep = 0;

type ReactionJob = { owner: string; priority: number; holdMs: number; run: () => void };
let activeReaction: ReactionJob = null;
let reactionTimer = 0;
let queuedReactions: ReactionJob[] = [];

function scheduleReaction(job: ReactionJob): boolean {
  if (reactionsPaused && job.owner !== 'chat') return false;
  if (activeReaction && activeReaction.owner !== job.owner && job.priority < activeReaction.priority) {
    if (job.owner === 'idle' || job.owner === 'proximity') return false;
    queuedReactions = [...queuedReactions.filter(item => item.owner !== job.owner), job].sort((a, b) => b.priority - a.priority).slice(0, 6);
    return false;
  }
  if (activeReaction && activeReaction.owner !== job.owner && ['music', 'activity'].includes(activeReaction.owner)) {
    queuedReactions = [...queuedReactions.filter(item => item.owner !== activeReaction.owner), activeReaction].sort((a, b) => b.priority - a.priority).slice(0, 6);
  }
  window.clearTimeout(reactionTimer);
  activeReaction = job;
  job.run();
  if (job.holdMs > 0) reactionTimer = window.setTimeout(() => releaseReaction(job.owner), job.holdMs);
  return true;
}

function cancelReaction(owner: string): void {
  queuedReactions = queuedReactions.filter(item => item.owner !== owner);
  if (activeReaction?.owner === owner) releaseReaction(owner);
}

function releaseReaction(owner: string): void {
  if (!activeReaction || activeReaction.owner !== owner) return;
  window.clearTimeout(reactionTimer);
  activeReaction = null;
  const next = queuedReactions.shift();
  if (next) scheduleReaction(next);
}

const emotionProfiles: Record<string, { expression: string; minimumIntensity: number }> = {
  neutral: { expression: 'idle-01', minimumIntensity: 0.25 },
  happy: { expression: 'joy-01', minimumIntensity: 0.65 },
  angry: { expression: 'anger-01', minimumIntensity: 0.65 },
  sad: { expression: 'sad-01', minimumIntensity: 0.55 },
  shy: { expression: 'shy-01', minimumIntensity: 0.5 },
  surprised: { expression: 'surprise-01', minimumIntensity: 0.65 },
  thinking: { expression: 'serious-01', minimumIntensity: 0.4 },
  encouraging: { expression: 'smile-02', minimumIntensity: 0.65 },
  refusing: { expression: 'serious-01', minimumIntensity: 0.55 },
  greeting: { expression: 'smile-01', minimumIntensity: 0.7 }
};

const customCatalog = (window as any).contentPacks?.get()?.catalog;

Promise.resolve(customCatalog || fetch('./assistant/action-catalog.json').then(response => response.json()))
  .then((value: ActionCatalog) => {
    catalog = value;
    if (queuedAction) {
      applyAction(queuedAction);
      queuedAction = null;
    }
  })
  .catch(error => console.error('Failed to load action catalog', error));

function choose<T extends CatalogAsset>(assets: T[], categories: string[], intensity = 0.5): T {
  const choices = assets.filter(asset => categories.includes(asset.category));
  if (!choices.length) return null;
  const target = Math.max(1, Math.min(5, Math.round(intensity * 5)));
  const leveled = choices.filter(asset => asset.level != null);
  if (!leveled.length) return choices[Math.floor(Math.random() * choices.length)];
  const closestDistance = Math.min(...leveled.map(asset => Math.abs(asset.level - target)));
  const closest = leveled.filter(asset => Math.abs(asset.level - target) === closestDistance);
  return closest[Math.floor(Math.random() * closest.length)];
}

function playNextQueuedSound(): void {
  if ((!speaking && !thinking) || activeAudio || !queuedSounds.length || soundVolume <= 0) return;
  const queued = queuedSounds.shift();
  const sound = queued.asset;
  activeAudioKind = queued.kind;
  const effectiveVolume = soundVolume * (queued.kind === 'effect' ? effectVolume : voiceVolume);
  if (effectiveVolume <= 0) return playNextQueuedSound();
  const audio = new Audio(sound.file);
  activeAudio = audio;
  try {
    audioContext ||= new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const gain = audioContext.createGain();
    const panner = audioContext.createStereoPanner();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    gain.gain.value = effectiveVolume;
    panner.pan.value = soundBalance;
    source.connect(gain).connect(panner).connect(analyser).connect(audioContext.destination);
    activeGain = gain;
    activePanner = panner;
    activeAnalyser = analyser;
    audio.volume = 1;
    audioContext.resume().catch(() => {});
    startVolumeMeter();
  } catch {
    audio.volume = effectiveVolume;
    window.dispatchEvent(new CustomEvent('assistant-volume-level', { detail: { level: effectiveVolume * 0.65 } }));
  }
  const finish = (): void => {
    if (activeAudio === audio) {
      activeAudio = null;
      stopVolumeMeter();
    }
    playNextQueuedSound();
  };
  audio.addEventListener('ended', finish, { once: true });
  audio.addEventListener('error', finish, { once: true });
  audio.play().catch(finish);
}

function startVolumeMeter(): void {
  window.cancelAnimationFrame(meterFrame);
  const samples = new Uint8Array(activeAnalyser?.fftSize || 256);
  let lastMeterAt = 0;
  const update = (timestamp = performance.now()): void => {
    if (!activeAnalyser || !activeAudio) return stopVolumeMeter();
    if (timestamp - lastMeterAt < 50) {
      meterFrame = window.requestAnimationFrame(update);
      return;
    }
    lastMeterAt = timestamp;
    activeAnalyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      energy += normalized * normalized;
    }
    const level = Math.min(1, Math.sqrt(energy / samples.length) * 3.2);
    window.dispatchEvent(new CustomEvent('assistant-volume-level', { detail: { level } }));
    meterFrame = window.requestAnimationFrame(update);
  };
  meterFrame = window.requestAnimationFrame(update);
}

function stopVolumeMeter(): void {
  window.cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  activeGain = null;
  activePanner = null;
  activeAnalyser = null;
  window.dispatchEvent(new CustomEvent('assistant-volume-level', { detail: { level: 0 } }));
}

function playAssetSound(sound: CatalogAsset, kind: 'voice' | 'effect' = 'voice'): void {
  if (!sound || soundVolume <= 0) return;
  queuedSounds.push({ asset: sound, kind });
  playNextQueuedSound();
}

function chooseUnusedSound(categories: string[], intensity: number): CatalogAsset {
  const preferred = catalog.sounds.filter(sound => categories.includes(sound.category) && !usedSounds.has(sound.id));
  const fallback = catalog.sounds.filter(sound => !usedSounds.has(sound.id));
  return choose(preferred.length ? preferred : fallback, preferred.length ? categories : fallback.map(sound => sound.category), intensity);
}

function chooseEffect(intent: string, intensity: number): CatalogAsset {
  const categories = catalog.effectMap?.[intent] || catalog.effectMap?.neutral || [];
  return choose(catalog.effects || [], categories, intensity);
}

function estimateSpeechMilliseconds(text: string): number {
  const speakingTimeMultiplier = 0.72;
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  const words = (text.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, ' ').match(/[\p{L}\p{N}']+/gu) || []).length;
  const pauses = (text.match(/[,;:，、；：]/g) || []).length;
  const stops = (text.match(/[.!?。！？\n]/g) || []).length;
  return Math.max(0, (cjk * 0.17 + words * 0.34 + pauses * 0.16 + stops * 0.32) * speakingTimeMultiplier * 1000);
}

function detectSentenceIntent(text: string, fallback: string): string {
  const value = text.toLocaleLowerCase();
  const rules: Array<[string, RegExp]> = [
    ['surprised', /\b(wow|whoa|really|seriously|unexpected|amazing)\b|[!?]{2,}|bất ngờ|thật sao|え[ぇえ]|まじ|本当/u],
    ['shy', /\b(shy|embarrass|blush|cute|sweet)\b|ngại|xấu hổ|照れ|恥ずか|えへへ/u],
    ['sad', /\b(sad|sorry|unfortunately|miss|hurt|cry|bad news)\b|buồn|xin lỗi|tiếc|悲し|残念|ごめん/u],
    ['angry', /\b(angry|annoy|hate|ridiculous|unacceptable)\b|tức|bực|ghét|怒|むかつ|ふざけ/u],
    ['encouraging', /\b(you can|good luck|keep going|believe|proud|well done)\b|cố lên|làm được|頑張|できる|応援/u],
    ['refusing', /\b(can't|cannot|won't|refuse|not allowed|no way)\b|không thể|từ chối|できない|だめ|無理/u],
    ['happy', /\b(happy|great|awesome|love|glad|congrat|fun|nice|haha|lol)\b|cảm ơn|tuyệt|vui|haha|嬉し|楽しい|ありがとう|ふふ|えへへ/u],
    ['thinking', /\b(maybe|perhaps|probably|think|consider|because|however|why|how)\b|có lẽ|tại sao|như thế nào|たぶん|かも|考え|なぜ|どう/u],
    ['greeting', /\b(hello|hey|welcome|good morning|good night|bye)\b|xin chào|chào|こんにちは|こんばんは|おはよう/u]
  ];
  return rules.find(([, pattern]) => pattern.test(value))?.[0] || fallback;
}

function applySentenceEmotion(intent: string): void {
  const safeIntent = intent in catalog.intentMap ? intent : activeIntent;
  const mapping = catalog.intentMap[safeIntent] || catalog.intentMap.neutral;
  const profile = emotionProfiles[safeIntent] || emotionProfiles.neutral;
  const explicitlyMappedExpressions = (mapping.expressionIds || [])
    .map(id => catalog.expressions.find(asset => asset.id === id)).filter(Boolean);
  const choices = (explicitlyMappedExpressions.length ? explicitlyMappedExpressions : catalog.expressions.filter(asset =>
    mapping.expressionCategories.includes(asset.category)
  )).filter(asset => asset.id !== currentExpressionId);
  const expression = choices[0] || catalog.expressions.find(asset => asset.id === profile.expression);
  if (expression) {
    currentExpressionId = expression.id;
    LAppDelegate.getInstance().setAssistantExpression(expression.id);
  }
  const conversationalMotions: Record<string, string[]> = {
    happy: ['yes-02_lv03', 'joy-01_lv03'], encouraging: ['motivate-01_lv03', 'yes-01_lv03'],
    refusing: ['no-02_lv03', 'reject-01_lv03'], shy: ['shy-01_lv03'],
    surprised: ['surprise-02_lv03'], thinking: ['think-01_lv03']
  };
  const syncedMotion = (mapping.motionIds || []).map(id => catalog.motions.find(asset => asset.id === id || asset.group === id)).find(Boolean);
  const preferredMotion = (conversationalMotions[safeIntent] || []).map(id => catalog.motions.find(asset => asset.group === id)).find(Boolean);
  const motion = syncedMotion || preferredMotion || choose(catalog.motions, mapping.motionCategories, activeIntensity);
  if (motion) LAppDelegate.getInstance().playAssistantMotion(motion.group, motionPriority(safeIntent, activeIntensity), motion.index || 0);
  LAppDelegate.getInstance().setAssistantPose(safeIntent, activeIntensity);
  if (playSound && safeIntent !== activeIntent) {
    const sound = chooseUnusedSound(mapping.soundCategories, activeIntensity);
    if (sound) usedSounds.add(sound.id);
    playAssetSound(chooseEffect(safeIntent, activeIntensity), 'effect');
    playAssetSound(sound, 'voice');
  }
  activeIntent = safeIntent;
}

function motionPriority(intent: string, intensity: number): 'normal' | 'force' {
  return ['surprised', 'angry', 'sad'].includes(intent) || intensity >= 0.82 ? 'force' : 'normal';
}

function scheduleTextEmotions(text: string): void {
  const segments: Array<{ start: number; text: string; complete: boolean }> = [];
  let start = 0;
  const boundary = /[.!?。！？\n]+/g;
  let match: RegExpExecArray;
  while ((match = boundary.exec(text)) !== null) {
    const sentence = text.slice(start, match.index + match[0].length).trim();
    if (sentence) segments.push({ start, text: sentence, complete: true });
    start = match.index + match[0].length;
  }
  const remainder = text.slice(start).trim();
  if (remainder) segments.push({ start, text: remainder, complete: false });

  for (let index = 1; index < segments.length; index++) {
    const segment = segments[index];
    if (scheduledSentenceStarts.has(segment.start) || (!segment.complete && segment.text.length < 12)) continue;
    scheduledSentenceStarts.add(segment.start);
    const intent = detectSentenceIntent(segment.text, activeIntent);
    const dueAt = estimateSpeechMilliseconds(text.slice(0, segment.start));
    const elapsed = performance.now() - speakingStartedAt;
    const timer = window.setTimeout(() => {
      if (speaking) applySentenceEmotion(intent);
    }, Math.max(0, dueAt - elapsed));
    emotionTimers.push(timer);
  }
}

function scheduleIdleVariation(): void {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!catalog || speaking || thinking || danceUntil > performance.now() || !idleAnimationsEnabled) {
      scheduleIdleVariation();
      return;
    }
    const hour = new Date().getHours();
    const night = hour >= 22 || hour < 6;
    const upbeat = ['greeting', 'happy', 'encouraging'].includes(activeIntent);
    const quietExpressions = night ? ['idle-01', 'pat-close-eye'] : upbeat ? ['smile-01', 'smile-02', 'joy-01'] : activeIntent === 'sad' ? ['smile-02', 'idle-01'] : ['idle-01', 'smile-01', 'smile-02'];
    const categories = night ? ['deep-breath', 'blink', 'idle'] : activeIntent === 'thinking' ? ['look-around', 'think', 'idle'] : upbeat ? ['happy', 'smile', 'idle'] : ['idle', 'blink', 'look-around', 'deep-breath'];
    const motion = choose(catalog.motions, categories, night ? 0.2 : upbeat ? 0.48 : 0.35);
    scheduleReaction({ owner: 'idle', priority: 5, holdMs: 3500, run: () => {
      const expressionId = quietExpressions[Math.floor(Math.random() * quietExpressions.length)];
      LAppDelegate.getInstance().setAssistantExpression(expressionId);
      if (motion) LAppDelegate.getInstance().playAssistantMotion(motion.group, 'normal', motion.index || 0);
    } });
    scheduleIdleVariation();
  }, 14000 + Math.random() * 16000);
}

function stopDanceLoop(notify = true): void {
  window.clearTimeout(danceTimer);
  danceTimer = 0;
  const wasDancing = danceUntil > 0;
  danceUntil = 0;
  if (wasDancing && notify) window.dispatchEvent(new CustomEvent('assistant-vibing-end'));
}

function startDanceLoop(motion: CatalogAsset, expression: string, intent: string, intensity: number): void {
  stopDanceLoop(false);
  danceUntil = performance.now() + 30000;
  const replay = (): void => {
    if (performance.now() >= danceUntil || activeReaction?.owner !== 'music' || speaking || thinking || reactionsPaused || !idleAnimationsEnabled) {
      stopDanceLoop();
      scheduleIdleVariation();
      return;
    }
    if (expression) LAppDelegate.getInstance().setAssistantExpression(expression);
    LAppDelegate.getInstance().setAssistantPose(intent, intensity);
    const danceChoices = ['dance-02_lv03', 'dance-01_lv03'].map(id => catalog.motions.find(asset => asset.group === id)).filter(Boolean);
    const nextMotion = danceChoices.length ? danceChoices[danceStep++ % danceChoices.length] : motion;
    LAppDelegate.getInstance().playAssistantMotion(nextMotion.group, 'normal', nextMotion.index || 0);
    danceTimer = window.setTimeout(replay, 3400);
  };
  replay();
}

function executeAction(action: AssistantAction): void {
  if (reactionsPaused) return;
  stopDanceLoop();
  if (!catalog) {
    queuedAction = action;
    return;
  }
  const intent = action.intent in catalog.intentMap ? action.intent : 'neutral';
  const mapping = catalog.intentMap[intent];
  const profile = emotionProfiles[intent] || emotionProfiles.neutral;
  const requestedIntensity = Number.isFinite(action.intensity) ? action.intensity : 0.5;
  const intensity = Math.max(profile.minimumIntensity, requestedIntensity);
  const mappedExpressions = (mapping.expressionIds || []).map(id => catalog.expressions.find(asset => asset.id === id)).filter(Boolean);
  const expressionChoices = mappedExpressions.length ? mappedExpressions : catalog.expressions.filter(asset =>
    mapping.expressionCategories.includes(asset.category)
  );
  const fallbackExpression = catalog.expressions.find(asset => asset.id === profile.expression);
  const expression = expressionChoices.length
    ? expressionChoices[Math.floor(Math.random() * expressionChoices.length)]
    : fallbackExpression;
  const mappedMotions = (mapping.motionIds || []).map(id => catalog.motions.find(asset => asset.id === id || asset.group === id)).filter(Boolean);
  pendingMotion = mappedMotions.length ? mappedMotions[Math.floor(Math.random() * mappedMotions.length)] : choose(catalog.motions, mapping.motionCategories, intensity);
  pendingSound = choose(catalog.sounds, mapping.soundCategories, intensity)
    || catalog.sounds[Math.floor(Math.random() * catalog.sounds.length)];
  pendingEffect = chooseEffect(intent, intensity);
  playSound = action.playSound === true;
  activeIntent = intent;
  activeIntensity = intensity;
  queuedSounds = [];
  usedSounds = new Set(pendingSound ? [pendingSound.id] : []);
  currentExpressionId = expression?.id || '';
  scheduledSentenceStarts = new Set<number>();
  emotionTimers.forEach(timer => window.clearTimeout(timer));
  emotionTimers = [];

  if (expression) LAppDelegate.getInstance().setAssistantExpression(expression.id);
  LAppDelegate.getInstance().setAssistantPose(intent, intensity);
  window.clearTimeout(resetTimer);
  window.clearTimeout(idleTimer);

  if (action.phase === 'thinking') {
    thinking = true;
    speaking = false;
    LAppDelegate.getInstance().setAssistantSpeaking(false);
    if (pendingMotion) LAppDelegate.getInstance().playAssistantMotion(pendingMotion.group, motionPriority(intent, intensity), pendingMotion.index || 0);
    if (playSound) {
      playAssetSound(pendingEffect, 'effect');
      playAssetSound(pendingSound, 'voice');
    }
    return;
  }

  thinking = false;
  speaking = true;
  speakingStartedAt = performance.now();
  LAppDelegate.getInstance().setAssistantSpeaking(true);
  if (pendingMotion) LAppDelegate.getInstance().playAssistantMotion(pendingMotion.group, motionPriority(intent, intensity), pendingMotion.index || 0);
  if (playSound) {
    playAssetSound(pendingEffect, 'effect');
    playAssetSound(pendingSound, 'voice');
  }
}

function applyAction(action: AssistantAction): void {
  if (!catalog) { queuedAction = action; return; }
  const speakingAction = action.phase === 'speaking';
  scheduleReaction({
    owner: speakingAction ? 'chat' : 'thinking',
    priority: speakingAction ? 100 : 85,
    holdMs: 60000,
    run: () => executeAction(action)
  });
}

window.addEventListener('assistant-action', ((event: CustomEvent<AssistantAction>) => {
  typingThinking = false;
  applyAction(event.detail || {});
}) as EventListener);

window.addEventListener('assistant-user-typing-start', () => {
  if (speaking || thinking || !catalog) return;
  typingThinking = true;
  applyAction({ intent: 'thinking', intensity: 0.42, playSound: false, phase: 'thinking' });
  LAppDelegate.getInstance().setAssistantExpression('serious-01');
  LAppDelegate.getInstance().setAssistantPose('thinking', 0.35);
  if (catalog.motions.some(asset => asset.group === 'notice-01_lv03')) {
    LAppDelegate.getInstance().playAssistantMotion('notice-01_lv03', 'normal');
  }
});

window.addEventListener('assistant-user-typing-end', () => {
  if (!typingThinking || speaking) return;
  typingThinking = false;
  thinking = false;
  releaseReaction('thinking');
  queuedSounds = [];
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
    stopVolumeMeter();
  }
  LAppDelegate.getInstance().setAssistantExpression('idle-01');
  LAppDelegate.getInstance().setAssistantPose('neutral', 0);
  const idleMotion = catalog && choose(catalog.motions, ['idle', 'default', 'blink'], 0.3);
  if (idleMotion) LAppDelegate.getInstance().playAssistantMotion(idleMotion.group, 'normal', idleMotion.index || 0);
  scheduleIdleVariation();
});

window.addEventListener('assistant-speaking-progress', ((event: CustomEvent<{ characters: number; text?: string }>) => {
  if (!speaking || !catalog) return;
  if (event.detail?.text) scheduleTextEmotions(event.detail.text);
}) as EventListener);

window.addEventListener('assistant-head-pat', () => {
  if (speaking || thinking) return;
  scheduleReaction({ owner: 'pat', priority: 70, holdMs: 2400, run: () => {
    window.clearTimeout(patTimer);
    window.clearTimeout(idleTimer);
    LAppDelegate.getInstance().setAssistantExpression('pat-close-eye');
    LAppDelegate.getInstance().setAssistantPose('shy', 0.55);
    LAppDelegate.getInstance().playAssistantMotion('bow-01_lv03', 'force');
    patTimer = window.setTimeout(() => {
      if (speaking || thinking) return;
      const expression = Math.random() < 0.55 ? 'shy-01' : 'smile-02';
      LAppDelegate.getInstance().setAssistantExpression(expression);
    }, 1000);
  } });
});

window.addEventListener('assistant-interaction', ((event: CustomEvent<{ type: string; speed?: number }>) => {
  if (!catalog || speaking || thinking || reactionsPaused) return;
  const profiles: Record<string, { intent: string; expression: string[]; motions: string[]; categories: string[]; intensity: number }> = {
    'head-click': { intent: 'shy', expression: ['shy-01', 'smile-02'], motions: ['shy-01_lv03', 'bow-01_lv03'], categories: ['shy', 'bow'], intensity: .5 },
    'face-click': { intent: 'surprised', expression: ['surprise-01', 'serious-01'], motions: ['surprise-01_lv03', 'question-01_lv03'], categories: ['surprise', 'question'], intensity: .58 },
    'body-click': { intent: 'surprised', expression: ['surprise-01'], motions: ['notice-01_lv03', 'surprise-02_lv03'], categories: ['notice', 'surprise'], intensity: .55 },
    'accessory-click': { intent: 'happy', expression: ['joy-01', 'smile-01'], motions: ['appeal-01_lv03', 'joy-01_lv03'], categories: ['appeal', 'joy'], intensity: .52 },
    circle: { intent: 'surprised', expression: ['surprise-01'], motions: ['look-around-01_lv03', 'question-02_lv03'], categories: ['question', 'surprise'], intensity: .62 },
    'rapid-cursor': { intent: 'happy', expression: ['joy-01'], motions: ['joy-04_lv03', 'happy-02_lv03'], categories: ['joy', 'happy'], intensity: .65 },
    'face-near': { intent: 'shy', expression: ['shy-01'], motions: ['shy-02_lv03'], categories: ['shy'], intensity: .48 },
    'drag-release': { intent: 'neutral', expression: ['idle-01'], motions: ['deep-breath-01_lv03', 'idle-01_lv03'], categories: ['idle'], intensity: .3 },
    'fast-drag-release': { intent: 'surprised', expression: ['surprise-01'], motions: ['surprise-03_lv03'], categories: ['surprise'], intensity: .72 },
    'repeated-drag': { intent: 'angry', expression: ['anger-01', 'serious-01'], motions: ['anger-01_lv03', 'provoke-01_lv03'], categories: ['anger', 'provoke'], intensity: .62 },
    'welcome-back': { intent: 'greeting', expression: ['smile-01', 'joy-01'], motions: ['greet-01_lv03', 'bow-01_lv03'], categories: ['greet', 'bow'], intensity: .62 },
    stretch: { intent: 'neutral', expression: ['idle-01'], motions: ['deep-breath-01_lv03', 'idle-01_lv03'], categories: ['idle'], intensity: .3 },
    'late-night': { intent: 'thinking', expression: ['pat-close-eye', 'idle-01'], motions: ['deep-breath-01_lv03', 'think-01_lv01'], categories: ['think', 'idle'], intensity: .28 }
    , 'long-session': { intent: 'encouraging', expression: ['smile-02', 'serious-01'], motions: ['motivate-01_lv03', 'listen-r_01_lv03'], categories: ['motivate', 'listen'], intensity: .42 }
    , 'track-change': { intent: 'happy', expression: ['joy-01', 'smile-02'], motions: ['notice-01_lv03', 'joy-01_lv03'], categories: ['notice', 'joy'], intensity: .52 }
  };
  const profile = profiles[event.detail?.type];
  if (!profile) return;
  const highPriority = ['head-click', 'fast-drag-release', 'repeated-drag', 'welcome-back'].includes(event.detail?.type);
  scheduleReaction({ owner: 'interaction', priority: highPriority ? 65 : 45, holdMs: 2800, run: () => {
    stopDanceLoop();
    window.clearTimeout(idleTimer);
    const expression = profile.expression.find(id => catalog.expressions.some(asset => asset.id === id));
    if (expression) LAppDelegate.getInstance().setAssistantExpression(expression);
    LAppDelegate.getInstance().setAssistantPose(profile.intent, profile.intensity);
    const motion = profile.motions.map(id => catalog.motions.find(asset => asset.group === id)).find(Boolean)
      || choose(catalog.motions, profile.categories, profile.intensity);
    if (motion) LAppDelegate.getInstance().playAssistantMotion(motion.group, highPriority ? 'force' : 'normal', motion.index || 0);
    activeIntent = profile.intent;
    scheduleIdleVariation();
  } });
}) as EventListener);

window.addEventListener('assistant-proximity', () => {
  if (!speaking && !thinking && !reactionsPaused) scheduleReaction({ owner: 'proximity', priority: 15, holdMs: 700, run: () => LAppDelegate.getInstance().setAssistantPose('thinking', .18) });
});

window.addEventListener('assistant-typing-rhythm', ((event: CustomEvent<{ rate: number }>) => {
  if (!catalog || speaking || reactionsPaused || !typingThinking) return;
  if (event.detail.rate > 6) {
    LAppDelegate.getInstance().setAssistantExpression('surprise-01');
    LAppDelegate.getInstance().setAssistantPose('surprised', .38);
  } else {
    LAppDelegate.getInstance().setAssistantExpression('serious-01');
  }
}) as EventListener);

window.addEventListener('assistant-user-activity', ((event: CustomEvent<{ kind: string; label?: string }>) => {
  if (!catalog || speaking || thinking || reactionsPaused || !idleAnimationsEnabled) return;
  const profiles: Record<string, { intent: string; expressions: string[]; motionIds: string[]; motionCategories: string[]; intensity: number }> = {
    music: {
      intent: 'happy', expressions: ['joy-01', 'smile-02'], intensity: 0.62,
      motionIds: ['dance-02_lv03', 'dance-01_lv03', 'listen-l_01_lv03', 'listen-r_01_lv03', 'joy-01_lv03'],
      motionCategories: ['dance', 'listen', 'joy']
    },
    browsing: {
      intent: 'thinking', expressions: ['serious-01', 'idle-01'], intensity: 0.38,
      motionIds: ['notice-01_lv03', 'question-01_lv03', 'think-01_lv03'], motionCategories: ['notice', 'question', 'think']
    },
    coding: {
      intent: 'thinking', expressions: ['serious-01', 'idle-01'], intensity: 0.42,
      motionIds: ['think-01_lv03', 'question-02_lv03', 'listen-r_01_lv03'], motionCategories: ['think', 'question', 'listen']
    },
    gaming: {
      intent: 'surprised', expressions: ['surprise-01', 'smile-01'], intensity: 0.58,
      motionIds: ['surprise-02_lv03', 'joy-04_lv03', 'happy-02_lv03'], motionCategories: ['surprise', 'joy', 'happy']
    }
  };
  const profile = profiles[event.detail?.kind];
  if (!profile) return;
  const owner = event.detail?.kind === 'music' ? 'music' : 'activity';
  scheduleReaction({ owner, priority: event.detail?.kind === 'music' ? 25 : 20, holdMs: event.detail?.kind === 'music' ? 30000 : 3000, run: () => {
    if (event.detail?.kind !== 'music') stopDanceLoop();
    window.clearTimeout(idleTimer);
    const expression = profile.expressions.find(id => catalog.expressions.some(asset => asset.id === id));
    if (expression) LAppDelegate.getInstance().setAssistantExpression(expression);
    LAppDelegate.getInstance().setAssistantPose(profile.intent, profile.intensity);
    const motion = profile.motionIds.map(id => catalog.motions.find(asset => asset.id === id || asset.group === id)).find(Boolean)
      || choose(catalog.motions, profile.motionCategories, profile.intensity);
    if (motion && event.detail?.kind === 'music') startDanceLoop(motion, expression, profile.intent, profile.intensity);
    else if (motion) LAppDelegate.getInstance().playAssistantMotion(motion.group, 'normal', motion.index || 0);
    activeIntent = profile.intent;
    scheduleIdleVariation();
  } });
}) as EventListener);

window.addEventListener('assistant-media-state', ((event: CustomEvent<{ playing: boolean }>) => {
  if (event.detail?.playing) return;
  stopDanceLoop();
  cancelReaction('music');
  if (!speaking && !thinking) {
    LAppDelegate.getInstance().setAssistantExpression('idle-01');
    LAppDelegate.getInstance().setAssistantPose('neutral', 0);
    scheduleIdleVariation();
  }
}) as EventListener);

window.addEventListener('assistant-speaking-end', () => {
  if (!speaking) return;
  LAppDelegate.getInstance().setAssistantSpeaking(false);
  speaking = false;
  thinking = false;
  releaseReaction('chat');
  pendingMotion = null;
  pendingSound = null;
  pendingEffect = null;
  queuedSounds = [];
  emotionTimers.forEach(timer => window.clearTimeout(timer));
  emotionTimers = [];
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
    stopVolumeMeter();
  }
  resetTimer = window.setTimeout(() => {
    if (speaking || thinking) return;
    LAppDelegate.getInstance().setAssistantExpression('idle-01');
    LAppDelegate.getInstance().setAssistantPose('neutral', 0);
    const idleMotion = catalog && choose(catalog.motions, ['idle', 'default', 'blink'], 0.3);
    if (idleMotion) LAppDelegate.getInstance().playAssistantMotion(idleMotion.group, 'normal', idleMotion.index || 0);
    scheduleIdleVariation();
  }, 900);
});

scheduleIdleVariation();

window.addEventListener('assistant-settings-change', ((event: CustomEvent) => {
  const settings = event.detail || {};
  const volume = Number(settings.soundVolume);
  if (Number.isFinite(volume)) soundVolume = Math.max(0, Math.min(1, volume));
  const voice = Number(settings.voiceVolume);
  if (Number.isFinite(voice)) voiceVolume = Math.max(0, Math.min(1, voice));
  const effect = Number(settings.effectVolume);
  if (Number.isFinite(effect)) effectVolume = Math.max(0, Math.min(1, effect));
  const balance = Number(settings.soundBalance);
  if (Number.isFinite(balance)) soundBalance = Math.max(-1, Math.min(1, balance));
  if (activeGain) activeGain.gain.value = soundVolume * (activeAudioKind === 'effect' ? effectVolume : voiceVolume);
  if (activePanner) activePanner.pan.value = soundBalance;
  idleAnimationsEnabled = settings.idleAnimations !== false;
  reactionsPaused = settings.reactionsPaused === true;
  if (reactionsPaused) {
    stopDanceLoop();
    queuedSounds = [];
    if (activeAudio) { activeAudio.pause(); activeAudio = null; stopVolumeMeter(); }
    LAppDelegate.getInstance().setAssistantSpeaking(false);
    LAppDelegate.getInstance().setAssistantExpression('idle-01');
    LAppDelegate.getInstance().setAssistantPose('neutral', 0);
  }
  if (idleAnimationsEnabled) scheduleIdleVariation();
  else window.clearTimeout(idleTimer);
}) as EventListener);
