// Loads Anurag's voice guide (voice/anurag.md) and a few writing samples (voice/samples/*.md|txt)
// so every post is written in the same voice as the Potato Tech YouTube channel.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'voice');
const MAX_SAMPLES = 3, MAX_SAMPLE_CHARS = 1500;

function read(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } }

function samples() {
  let files = [];
  try { files = fs.readdirSync(path.join(DIR, 'samples')).filter(f => /\.(md|txt)$/i.test(f) && !/^readme/i.test(f)).sort(); } catch { /* no samples yet */ }
  return files.slice(0, MAX_SAMPLES).map(f => read(path.join(DIR, 'samples', f)).slice(0, MAX_SAMPLE_CHARS)).filter(Boolean);
}

// Text to append to the system prompt. Empty string when the voice folder is missing, so the pipeline still runs.
function voiceBlock() {
  const guide = read(path.join(DIR, 'anurag.md'));
  if (!guide) return '';
  const s = samples();
  return `\n\nAUTHOR VOICE (you are writing as Anurag from the Potato Tech YouTube channel; this overrides the generic voice above where they differ)\n${guide}` +
    (s.length ? `\n\nSAMPLES OF HOW ANURAG WRITES AND TALKS (match the rhythm and attitude, never copy sentences or facts from them):\n${s.map((t, i) => `--- sample ${i + 1} ---\n${t}`).join('\n')}` : '');
}

module.exports = { voiceBlock };
