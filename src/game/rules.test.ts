import test from 'node:test';
import assert from 'node:assert/strict';
import { answerVariants, findAnswerMatch, getPlayerRank, matchVoiceToOption, matchVoiceToPlayerCount, scoreDelta, similarity } from './rules.ts';
import { EIGHTIES_PACK } from '../../shared/packs/eighties.ts';

test('matchVoiceToPlayerCount recognizes spoken and numeric counts from one to four', () => {
  assert.equal(matchVoiceToPlayerCount('There are two players'), 2);
  assert.equal(matchVoiceToPlayerCount('4'), 4);
  assert.equal(matchVoiceToPlayerCount('one'), 1);
  assert.equal(matchVoiceToPlayerCount('five players'), null);
});

test('answerVariants expands parentheticals and aliases', () => {
  assert.deepEqual(answerVariants('A-ha ("Take On Me")', ['aha']), ['a ha take on me', 'a ha', 'take on me', 'aha']);
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

test('generic words do not trigger a match', () => {
  const options = ['A-ha ("Take On Me")', 'Duran Duran ("Rio")', 'Depeche Mode ("Just Can\'t Get Enough")', 'Wham! ("Wake Me Up Before You Go-Go")'];
  assert.equal(matchVoiceToOption("I'll take Duran Duran", options), 1);
  assert.equal(matchVoiceToOption('take', options), null);
  assert.equal(matchVoiceToOption('just wake me up', options), null);
  assert.equal(matchVoiceToOption('wake me up before you go go', options), 3);
});

test('fuzzy matching tolerates speech-to-text slips', () => {
  assert.equal(matchVoiceToOption('rick ashley', ['Rick Astley', 'George Michael', 'Jason Donovan', 'Kylie Minogue']), 0);
  assert.equal(matchVoiceToOption('kylie', ['Rick Astley', 'George Michael', 'Jason Donovan', 'Kylie Minogue']), 3);
  assert.ok(similarity('astley', 'ashley') >= 0.8);
});

test('accepted aliases from the pack count as correct', () => {
  const question = EIGHTIES_PACK.questions.find(entry => entry.id === '80s-song-never-gonna')!;
  const match = findAnswerMatch('that is rick', question.options, { [question.correctIndex]: question.acceptedAnswers! });
  assert.equal(match?.optionIndex, 0);
  const full = findAnswerMatch('never gonna give you up', question.options, { [question.correctIndex]: question.acceptedAnswers! });
  assert.equal(full?.optionIndex, 0);
});

test('the best-scoring option wins when several partially match', () => {
  const options = ['Terminator 2: Judgment Day', 'Predator 2', 'Total Recall', 'Last Action Hero'];
  assert.equal(matchVoiceToOption('terminator two judgment day', options), 0);
  assert.equal(matchVoiceToOption('predator', options), 1);
});

test('scoring awards streak bonuses and penalises wrong answers', () => {
  const question = EIGHTIES_PACK.questions[0];
  assert.deepEqual(scoreDelta(question, 'correct', 0), { delta: 1000, bonus: 0 });
  assert.deepEqual(scoreDelta(question, 'correct', 1), { delta: 1500, bonus: 500 });
  assert.deepEqual(scoreDelta(question, 'wrong', 3), { delta: -1000, bonus: 0 });
  assert.deepEqual(scoreDelta(question, 'timeout', 3), { delta: 0, bonus: 0 });
  assert.deepEqual(scoreDelta(question, 'pass', 0), { delta: 0, bonus: 0 });
});

test('getPlayerRank assigns titles by score', () => {
  assert.equal(getPlayerRank(15000).title, 'TRIVIA OVERLORD');
  assert.equal(getPlayerRank(8000).title, 'ARCADE CHAMPION');
  assert.equal(getPlayerRank(4000).title, 'CERTIFIED MALL RAT');
  assert.equal(getPlayerRank(500).title, 'CASSETTE TAPE ROOKIE');
  assert.equal(getPlayerRank(-500).title, 'GAG ME WITH A SPOON');
});
