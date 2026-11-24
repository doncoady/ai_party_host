import test from 'node:test';
import assert from 'node:assert/strict';
import { clipRequestFor, mockPack, songQuestion, spokenAliases } from './packs.ts';
import type { CatalogTrack } from './catalog.ts';
import { EIGHTIES_PACK } from '../shared/packs/eighties.ts';
import { findBuiltinPack } from '../shared/packs/index.ts';

test('built-in packs are found by many spellings of the theme', () => {
  assert.equal(findBuiltinPack('the 80s')?.id, 'builtin-80s');
  assert.equal(findBuiltinPack('Eighties')?.id, 'builtin-80s');
  assert.equal(findBuiltinPack('1990s')?.id, 'builtin-90s');
  assert.equal(findBuiltinPack('Star Wars'), null);
});

test('built-in packs are well formed', () => {
  for (const pack of [EIGHTIES_PACK, findBuiltinPack('90s')!]) {
    assert.equal(pack.questions.length, 8, `${pack.id} needs 8 songs for two rounds of four`);
    assert.equal(new Set(pack.questions.map(question => question.id)).size, pack.questions.length);
    for (const question of pack.questions) {
      assert.equal(question.type, 'SONG_CLIP');
      assert.equal(question.options.length, 4, question.id);
      assert.ok(question.correctIndex >= 0 && question.correctIndex < 4);
      assert.ok(question.acceptedAnswers && question.acceptedAnswers.length > 0, `${question.id} needs spoken aliases`);
      assert.ok(question.song.artist && question.song.title, question.id);
    }
  }
});

test('mock packs are deterministic songs answering the NATO alphabet', () => {
  const pack = mockPack('Pirates');
  assert.equal(pack.questions.length, 26);
  assert.ok(pack.questions.every(question => question.type === 'SONG_CLIP'));
  assert.equal(pack.questions[0].options[0], 'Alpha');
  assert.equal(pack.questions[8].options[0], 'India');
  assert.deepEqual(mockPack('Pirates'), pack);
});

test('clip requests are derived from song metadata and cut from the opening by default', () => {
  const song = clipRequestFor(EIGHTIES_PACK.questions[0], 3);
  assert.equal(song.artist, 'a-ha');
  assert.ok(song.directUrl?.startsWith('https://'));
  assert.equal(song.position, 'start');
  assert.equal(clipRequestFor(EIGHTIES_PACK.questions[0], 3, 'hook').position, 'hook');
});

test('catalog tracks become Name That Tune questions with spoken aliases and distractors', () => {
  const tracks: CatalogTrack[] = [
    { key: 'a-ha|take on me', artist: 'a-ha', title: 'Take On Me', previewUrl: 'https://x/1.m4a', year: 1985, provider: 'itunes', popularity: 3 },
    { key: 'the human league|dont you want me', artist: 'The Human League', title: "Don't You Want Me", previewUrl: 'https://x/2.m4a', provider: 'deezer', popularity: 2 },
    { key: 'europe|the final countdown', artist: 'Europe', title: 'The Final Countdown', previewUrl: 'https://x/3.m4a', provider: 'deezer', popularity: 2 },
    { key: 'toto|africa', artist: 'Toto', title: 'Africa', previewUrl: 'https://x/4.m4a', provider: 'deezer', popularity: 1 },
  ];
  const question = songQuestion(tracks[1], tracks, 1, 'The 80s');
  assert.equal(question.type, 'SONG_CLIP');
  assert.equal(question.options[0], 'The Human League ("Don\'t You Want Me")');
  assert.equal(question.options.length, 4);
  assert.ok(question.acceptedAnswers!.includes('human league'));
  assert.ok(question.acceptedAnswers!.includes("don't you want me"));
  assert.equal(question.song?.previewUrl, 'https://x/2.m4a');
  assert.match(question.hostClue, /starts with "T"/);
  assert.deepEqual(spokenAliases({ artist: 'Simon & Garfunkel', title: 'Mrs. Robinson (From "The Graduate")' }).slice(0, 2), ['mrs. robinson', 'mrs robinson']);
});
