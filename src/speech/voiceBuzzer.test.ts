import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDispatchVoiceTranscript } from './voiceBuzzer.ts';

test('ignores interim speech recognition results', () => {
  assert.equal(shouldDispatchVoiceTranscript(false, false, 1000, 0), false);
});

test('ignores final transcripts captured during audio playback', () => {
  assert.equal(shouldDispatchVoiceTranscript(true, true, 1000, 0), false);
});

test('ignores echo during the playback cooldown and accepts later speech', () => {
  assert.equal(shouldDispatchVoiceTranscript(true, false, 1300, 1500), false);
  assert.equal(shouldDispatchVoiceTranscript(true, false, 1500, 1500), true);
});
