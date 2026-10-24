const fs = require('fs');
const path = require('path');

const effectRoot = path.resolve(__dirname, '..', 'assets', 'soundext');
const outputDir = path.join(__dirname, 'public', 'assistant');

function readWaveDuration(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.toString('ascii', 0, 4) !== 'RIFF') return null;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === 'fmt ' && size >= 12) byteRate = data.readUInt32LE(offset + 16);
    if (id === 'data') { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  return byteRate && dataSize ? Number((dataSize / byteRate).toFixed(3)) : null;
}

const effects = fs.existsSync(effectRoot) ? fs.readdirSync(effectRoot)
  .filter(name => name.toLowerCase().endsWith('.wav'))
  .sort()
  .map(name => {
    const id = path.basename(name, '.wav');
    const category = id.replace(/^se_adv_eff_/, '').replace(/-\d{3}(?:[-_]\d+)?$/, '');
    return { id, file: `./SfxExt/${name}`, category, durationSeconds: readWaveDuration(path.join(effectRoot, name)), tags: ['effect', category] };
  }) : [];

const intentMap = {
  neutral: { motionCategories: ['idle', 'default', 'blink', 'deep-breath', 'look-around'], expressionCategories: ['idle', 'face'], soundCategories: ['address', 'adverb', 'conjunction', 'symbol'] },
  happy: { motionCategories: ['happy', 'joy', 'smile', 'dance', 'wink'], expressionCategories: ['joy', 'smile'], soundCategories: ['glad', 'enjoy', 'laugh', 'positive'] },
  angry: { motionCategories: ['anger', 'provoke', 'shout'], expressionCategories: ['anger', 'serious'], soundCategories: ['angry', 'caution', 'scream'] },
  sad: { motionCategories: ['sad', 'cry', 'tear', 'disappoint'], expressionCategories: ['sad'], soundCategories: ['sad', 'cry', 'sorry'] },
  shy: { motionCategories: ['shy'], expressionCategories: ['shy'], soundCategories: ['embarrassed'] },
  surprised: { motionCategories: ['surprise', 'notice'], expressionCategories: ['surprise'], soundCategories: ['surprised', 'shock', 'notice'] },
  thinking: { motionCategories: ['think', 'question', 'listen'], expressionCategories: ['serious'], soundCategories: ['think', 'question'] },
  encouraging: { motionCategories: ['motivate', 'yes', 'appeal'], expressionCategories: ['smile', 'joy'], soundCategories: ['motivate', 'support', 'advice', 'empathy'] },
  refusing: { motionCategories: ['no'], expressionCategories: ['serious', 'anger'], soundCategories: ['denial', 'reject'] },
  greeting: { motionCategories: ['bow', 'yes'], expressionCategories: ['smile'], soundCategories: ['greet', 'thanks'] }
};

const effectMap = {
  neutral: ['note', 'dozing', 'sneeze'], happy: ['fun', 'happy', 'kira', 'love', 'doya', 'note'],
  angry: ['angry', 'trembling', 'panic'], sad: ['cry', 'sigh', 'trembling'],
  shy: ['shy', 'nervous', 'love', 'trembling'], surprised: ['shock', 'notice', 'exclamation', 'exclamation-question', 'panic'],
  thinking: ['think', 'question', 'guruguru', 'inspiration'], encouraging: ['kira', 'happy', 'inspiration', 'note'],
  refusing: ['sigh', 'angry', 'exclamation'], greeting: ['note', 'kira', 'happy']
};

const categories = {};
for (const effect of effects) {
  categories[effect.category] ||= { expressions: [], motions: [], sounds: [], effects: [] };
  categories[effect.category].effects.push(effect.id);
}

const catalog = {
  schemaVersion: 1, model: null, pathsAreRelativeToApp: true,
  counts: { expressions: 0, motions: 0, sounds: 0, effects: effects.length },
  expressions: [], motions: [], sounds: [], effects, categories, intentMap, effectMap
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'action-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated source-only catalog with ${effects.length} external sound effects.`);
