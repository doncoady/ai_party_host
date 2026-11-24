import test from 'node:test';
import assert from 'node:assert/strict';
import { isLikelyNoise } from './voiceInput.ts';

const welcome = { text: "Welcome to the party. What's tonight's theme? A decade, a genre, a franchise, or say surprise me.", endedAt: 1000 };

test('silence hallucinations and punctuation are noise', () => {
  for (const sample of ['.', '...', 'Thank you.', 'thanks for watching', 'hmm', 'uh', 'you', '']) {
    assert.equal(isLikelyNoise(sample, null, 1500), true, sample);
  }
});

test('short commands that reuse prompt words are not echoes', () => {
  assert.equal(isLikelyNoise('surprise me', welcome, 1500), false);
  assert.equal(isLikelyNoise('the theme is the nineties', welcome, 1500), false);
  assert.equal(isLikelyNoise('new theme', { text: 'Say play again or new theme.', endedAt: 1000 }, 1500), false);
  assert.equal(isLikelyNoise('video game music, 1 player', { text: 'Video Game Music. Bold choice. How many players are joining us?', endedAt: 1000 }, 1500), false);
});

test('verbatim runs of the host line right after it ends are echoes', () => {
  assert.equal(isLikelyNoise('a decade a genre a franchise', welcome, 1500), true);
  assert.equal(isLikelyNoise(welcome.text, welcome, 2500), true);
  assert.equal(isLikelyNoise('a decade a genre a franchise', welcome, 9000), false, 'echo window has passed');
});
