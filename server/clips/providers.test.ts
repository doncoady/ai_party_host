import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForCompare, rankDeezer, rankItunes, rankYoutubeCandidates, tokenOverlap, type ClipRequest } from './providers.ts';

const request: ClipRequest = { query: 'a-ha Take On Me', artist: 'a-ha', title: 'Take On Me', targetSeconds: 3 };

test('normalizeForCompare strips noise words and punctuation', () => {
  assert.equal(normalizeForCompare('a-ha - Take On Me (Official Video) [HD]'), 'ha take on me');
  assert.equal(tokenOverlap('Take On Me', 'a-ha - Take On Me (Official Video)'), 1);
  assert.ok(tokenOverlap('Take On Me', 'Rio') < 0.5);
});

test('YouTube candidates prefer official audio of the right length over covers and live versions', () => {
  const ranked = rankYoutubeCandidates([
    { id: 'cover', title: 'Take On Me - Acoustic Cover', duration: 210, url: 'u1' },
    { id: 'official', title: 'a-ha - Take On Me (Official Audio)', duration: 225, url: 'u2', uploader: 'a-ha - Topic' },
    { id: 'live', title: 'a-ha - Take On Me (Live 1986)', duration: 260, url: 'u3' },
    { id: 'hour', title: 'Take On Me 1 hour loop', duration: 3600, url: 'u4' },
  ], request);
  assert.equal(ranked[0].id, 'official');
  assert.equal(ranked[ranked.length - 1].id, 'hour');
});

test('iTunes and Deezer results are ranked by title and artist match', () => {
  const itunes = rankItunes([
    { trackName: 'Take On Me (Live)', artistName: 'Some Cover Band', previewUrl: 'a' },
    { trackName: 'Take On Me', artistName: 'a-ha', previewUrl: 'b' },
    { trackName: 'Rio', artistName: 'Duran Duran', previewUrl: 'c' },
  ], request);
  assert.equal(itunes[0].result.previewUrl, 'b');
  const deezer = rankDeezer([
    { title: 'Take On Me', artist: { name: 'a-ha' }, preview: 'x' },
    { title: 'Take On Me', artist: { name: 'Weezer' }, preview: 'y' },
  ], request);
  assert.equal(deezer[0].result.preview, 'x');
});
