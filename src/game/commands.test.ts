import test from 'node:test';
import assert from 'node:assert/strict';
import { isFillerOnly, parseVoiceCommands, prettyTheme, spokenName, wordToNumber, type ParseContext } from './commands.ts';

const types = (text: string, expecting?: ParseContext['expecting']) =>
  parseVoiceCommands(text, { expecting }).map(command => command.type);

test('wordToNumber handles digits and number words', () => {
  assert.equal(wordToNumber('3'), 3);
  assert.equal(wordToNumber('twelve'), 12);
  assert.equal(wordToNumber('banana'), null);
});

test('theme can be set with natural phrasing', () => {
  assert.deepEqual(parseVoiceCommands('the theme is the nineties'), [{ type: 'set-theme', theme: 'The 90s' }]);
  assert.deepEqual(parseVoiceCommands("let's play star wars trivia"), [{ type: 'set-theme', theme: 'Star Wars' }]);
  assert.deepEqual(parseVoiceCommands('set the theme to disney movies please'), [{ type: 'set-theme', theme: 'Disney Movies' }]);
  assert.deepEqual(parseVoiceCommands('change theme to hip hop'), [{ type: 'set-theme', theme: 'Hip Hop' }]);
  assert.deepEqual(parseVoiceCommands('surprise me'), [{ type: 'surprise-theme' }]);
});

test('bare utterances become the theme only when a theme is expected', () => {
  assert.deepEqual(parseVoiceCommands('eighties', { expecting: 'theme' }), [{ type: 'set-theme', theme: 'The 80s' }]);
  assert.deepEqual(parseVoiceCommands('classic rock', { expecting: 'theme' }), [{ type: 'set-theme', theme: 'Classic Rock' }]);
  assert.deepEqual(parseVoiceCommands('classic rock', { expecting: 'answer' }), []);
});

test('one utterance can carry several settings', () => {
  const commands = parseVoiceCommands('two players, theme is the 80s, ten seconds per turn, hard mode');
  assert.deepEqual(commands.map(command => command.type).sort(), ['set-difficulty', 'set-player-count', 'set-theme', 'set-turn-seconds']);
  assert.ok(commands.some(command => command.type === 'set-theme' && command.theme === 'The 80s'));
  assert.ok(commands.some(command => command.type === 'set-player-count' && command.count === 2));
  assert.ok(commands.some(command => command.type === 'set-turn-seconds' && command.seconds === 10));
  assert.ok(commands.some(command => command.type === 'set-difficulty' && command.difficulty === 'hard'));
});

test('player count phrasing', () => {
  assert.deepEqual(parseVoiceCommands('there are three of us'), [{ type: 'set-player-count', count: 3 }]);
  assert.deepEqual(parseVoiceCommands('just me'), [{ type: 'set-player-count', count: 1 }]);
  assert.deepEqual(parseVoiceCommands('four', { expecting: 'player-count' }), [{ type: 'set-player-count', count: 4 }]);
  assert.deepEqual(parseVoiceCommands('four', { expecting: 'none' }), []);
  assert.deepEqual(parseVoiceCommands('we have 2 players'), [{ type: 'set-player-count', count: 2 }]);
});

test('rounds, clip length and music controls', () => {
  assert.deepEqual(parseVoiceCommands('three rounds'), [{ type: 'set-rounds', rounds: 3 }]);
  assert.deepEqual(parseVoiceCommands('five second clips'), [{ type: 'set-clip-seconds', seconds: 5 }]);
  assert.deepEqual(parseVoiceCommands('turn off the music'), [{ type: 'music', enabled: false }]);
  assert.deepEqual(parseVoiceCommands('turn the music back on'), [{ type: 'music', enabled: true }]);
  assert.deepEqual(parseVoiceCommands('turn off sound effects'), [{ type: 'sfx', enabled: false }]);
});

test('navigation commands', () => {
  assert.deepEqual(types('next'), ['next']);
  assert.deepEqual(types('play it again', 'answer'), ['replay']);
  assert.deepEqual(types("I don't know, pass", 'answer'), ['pass']);
  assert.deepEqual(types("what's the score"), ['scoreboard']);
  assert.deepEqual(types('help'), ['help']);
  assert.deepEqual(types('play again'), ['play-again']);
  assert.deepEqual(types('new theme'), ['new-theme']);
  assert.deepEqual(types('quick start'), ['quick-start']);
  assert.deepEqual(types("let's go"), ['start-game']);
});

test('confirmation words are only recognised when a confirmation is expected', () => {
  assert.deepEqual(types('yes', 'confirmation'), ['yes']);
  assert.deepEqual(types('yeah lock it in', 'confirmation'), ['yes']);
  assert.deepEqual(types('no wait', 'confirmation'), ['no']);
  assert.deepEqual(types('yes', 'none'), []);
});

test('final answer shortcut skips confirmation', () => {
  assert.deepEqual(parseVoiceCommands('top gun final answer', { expecting: 'answer' }), [{ type: 'final-answer', answer: 'top gun' }]);
  assert.deepEqual(parseVoiceCommands("I'll go with ghostbusters", { expecting: 'answer' }), [{ type: 'final-answer', answer: 'ghostbusters' }]);
});

test('answers that merely contain a difficulty word are not settings', () => {
  assert.deepEqual(parseVoiceCommands('die hard', { expecting: 'answer' }), []);
});

test('filler detection and names', () => {
  assert.equal(isFillerOnly('um, uh'), true);
  assert.equal(isFillerOnly('bob'), false);
  assert.equal(spokenName('my name is bob'), 'Bob');
  assert.equal(spokenName("I'm sarah jane."), 'Sarah Jane');
  assert.equal(spokenName('call me DJ'), 'DJ');
  assert.equal(prettyTheme('the 1980s'), 'The 80s');
  assert.equal(prettyTheme('star wars'), 'Star Wars');
});
