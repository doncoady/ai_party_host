import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  calculateDecayedPoints, 
  calculatePenalty, 
  canPlayerBuzz, 
  executeScrew, 
  matchVoiceToPlayer, 
  matchVoiceToOption,
  getPlayerRank
} from './rules.ts';
import type { Player } from './types.ts';

const mockPlayers: Player[] = [
  {
    id: 'p1',
    name: 'Neon Nancy',
    score: 1000,
    color: 'emerald',
    borderHex: '#10b981',
    bgHex: '#064e3b',
    key: 'q',
    voiceTriggerWords: ['nancy', 'neon', 'green', 'one'],
    avatar: '🎸',
    screwsRemaining: 1,
    buzzCount: 2,
    correctCount: 2
  },
  {
    id: 'p2',
    name: 'Rad Rick',
    score: 500,
    color: 'pink',
    borderHex: '#ec4899',
    bgHex: '#831843',
    key: 'p',
    voiceTriggerWords: ['rick', 'rad', 'pink', 'two'],
    avatar: '🕶️',
    screwsRemaining: 1,
    buzzCount: 1,
    correctCount: 1
  }
];

test('calculateDecayedPoints decays from basePoints down to floor', () => {
  // At start (0 seconds), returns full points
  assert.equal(calculateDecayedPoints(1000, 0, 15), 1000);
  
  // At halfway (7.5s out of 15s), points are decreased
  const midPoints = calculateDecayedPoints(1000, 7.5, 15);
  assert.ok(midPoints < 1000 && midPoints > 200, `Mid points ${midPoints} should be between 200 and 1000`);

  // At end (>= 15s), points reach floor (200)
  assert.equal(calculateDecayedPoints(1000, 15, 15), 200);
  assert.equal(calculateDecayedPoints(1000, 20, 15), 200);
});

test('calculatePenalty returns negative points', () => {
  assert.equal(calculatePenalty(800), -800);
  assert.equal(calculatePenalty(1000), -1000);
});

test('canPlayerBuzz validates lockout and question state', () => {
  // Question active, no current buzzer, not locked out -> ALLOWED
  assert.equal(canPlayerBuzz('p1', [], null, true), true);

  // Question inactive -> NOT ALLOWED
  assert.equal(canPlayerBuzz('p1', [], null, false), false);

  // Someone already buzzed in -> NOT ALLOWED
  assert.equal(canPlayerBuzz('p2', [], 'p1', true), false);

  // Player is locked out for this question -> NOT ALLOWED
  assert.equal(canPlayerBuzz('p1', ['p1'], null, true), false);
});

test('executeScrew deducts screw and validates rules', () => {
  // Valid screw from p1 to p2
  const res = executeScrew('p1', 'p2', mockPlayers);
  assert.equal(res.success, true);
  const screwer = res.updatedPlayers.find(p => p.id === 'p1');
  assert.equal(screwer?.screwsRemaining, 0);

  // Cannot screw yourself
  const selfScrew = executeScrew('p1', 'p1', mockPlayers);
  assert.equal(selfScrew.success, false);

  // Cannot screw if 0 screws left
  const exhaustedPlayers = [{ ...mockPlayers[0], screwsRemaining: 0 }];
  const noScrew = executeScrew('p1', 'p2', exhaustedPlayers);
  assert.equal(noScrew.success, false);
});

test('matchVoiceToPlayer correctly identifies player by name or trigger phrase', () => {
  assert.equal(matchVoiceToPlayer('I am Nancy let me answer', mockPlayers)?.id, 'p1');
  assert.equal(matchVoiceToPlayer('Rad Rick here', mockPlayers)?.id, 'p2');
  assert.equal(matchVoiceToPlayer('player two buzz', mockPlayers)?.id, 'p2');
  assert.equal(matchVoiceToPlayer('completely unrelated sentence', mockPlayers), null);
});

test('matchVoiceToOption matches numbers, letters and choice phrases', () => {
  const options = ['Ghostbusters', 'Back to the Future', 'Top Gun', 'E.T.'];
  assert.equal(matchVoiceToOption('Option 1', options), 0);
  assert.equal(matchVoiceToOption('Choice B', options), 1);
  assert.equal(matchVoiceToOption('Number three', options), 2);
  assert.equal(matchVoiceToOption('fourth', options), 3);
  assert.equal(matchVoiceToOption('Ghostbusters for sure', options), 0);
  assert.equal(matchVoiceToOption('Top Gun', options), 2);
  assert.equal(matchVoiceToOption('gibberish', options), null);
});

test('getPlayerRank assigns authentic nostalgic 80s titles', () => {
  assert.equal(getPlayerRank(15000).title, 'TUBULAR 80s OVERLORD');
  assert.equal(getPlayerRank(8000).title, 'RADICAL ARCADE CHAMPION');
  assert.equal(getPlayerRank(4000).title, 'TOTALLY AWESOME MALL RAT');
  assert.equal(getPlayerRank(500).title, 'CASSETTE TAPE ROOKIE');
  assert.equal(getPlayerRank(-500).title, 'GAG ME WITH A SPOON');
});
