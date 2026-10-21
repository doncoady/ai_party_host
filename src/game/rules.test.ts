import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerRank, matchVoiceToOption, matchVoiceToPlayerCount } from './rules.ts';

test('matchVoiceToPlayerCount recognizes spoken and numeric counts from one to four', () => {
  assert.equal(matchVoiceToPlayerCount('There are two players'), 2);
  assert.equal(matchVoiceToPlayerCount('4'), 4);
  assert.equal(matchVoiceToPlayerCount('one'), 1);
  assert.equal(matchVoiceToPlayerCount('five players'), null);
});

test('matchVoiceToOption matches spoken answers without relying on multiple-choice labels', () => {
  const options = ['Ghostbusters', 'Back to the Future', 'Top Gun', 'E.T.'];
  assert.equal(matchVoiceToOption('B', options), null);
  assert.equal(matchVoiceToOption('Number three', options), null);
  assert.equal(matchVoiceToOption('Ghostbusters for sure', options), 0);
  assert.equal(matchVoiceToOption('Top Gun', options), 2);
  assert.equal(matchVoiceToOption('Back to the Future is my final answer', options), 1);
  assert.equal(matchVoiceToOption('I think the answer is Ghostbusters', options), 0);
  assert.equal(matchVoiceToOption('gibberish', options), null);
});

test('getPlayerRank assigns nostalgic 80s titles by score', () => {
  assert.equal(getPlayerRank(15000).title, 'TUBULAR 80s OVERLORD');
  assert.equal(getPlayerRank(8000).title, 'RADICAL ARCADE CHAMPION');
  assert.equal(getPlayerRank(4000).title, 'TOTALLY AWESOME MALL RAT');
  assert.equal(getPlayerRank(500).title, 'CASSETTE TAPE ROOKIE');
  assert.equal(getPlayerRank(-500).title, 'GAG ME WITH A SPOON');
});
