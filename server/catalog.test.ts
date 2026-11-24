import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceByArtist, cleanTitle, demoteThemeWordTracks, matchGenre, rankPlaylists, themeQueries, trackKey, type CatalogTrack } from './catalog.ts';

test('titles are cleaned of edition noise so duplicates collapse', () => {
  assert.equal(cleanTitle('Take On Me (2015 Remaster)'), 'Take On Me');
  assert.equal(cleanTitle('Blue Monday - 2016 Remastered Version'), 'Blue Monday');
  assert.equal(cleanTitle("Don't You Want Me (feat. Susan Ann Sulley)"), "Don't You Want Me");
  assert.equal(trackKey('A-ha', 'Take On Me (Remastered)'), trackKey('a-ha', 'Take On Me'));
});

test('decade themes expand to the playlist names catalogs actually use', () => {
  assert.deepEqual(themeQueries('The 80s'), ['80s', '80s hits', 'best of the 80s', '80s pop']);
  assert.deepEqual(themeQueries('eighties'), ['eighties', '80s hits', 'best of the 80s', '80s pop']);
  assert.deepEqual(themeQueries('Disney'), ['Disney', 'Disney hits', 'Disney songs']);
});

test('playlists are ranked by title match, popularity and sensible size', () => {
  const ranked = rankPlaylists([
    { id: 1, title: 'My random mix', nb_tracks: 40, fans: 2 },
    { id: 2, title: '80s Hits', nb_tracks: 120, fans: 250_000 },
    { id: 3, title: '80s', nb_tracks: 5, fans: 10 },
    { id: 4, title: 'Best of the 80s', nb_tracks: 80, fans: 900 },
  ], '80s');
  assert.deepEqual(ranked.map(playlist => playlist.id), [2, 4]);
});

test('artist balancing keeps a round varied', () => {
  const track = (artist: string, title: string): CatalogTrack => ({ key: `${artist}|${title}`, artist, title, provider: 'deezer', popularity: 1 });
  const balanced = balanceByArtist([track('Prince', 'A'), track('Prince', 'B'), track('Prince', 'C'), track('Madonna', 'D')], 2);
  assert.deepEqual(balanced.map(entry => entry.title), ['A', 'B', 'D']);
});

test('theme words must describe the playlist, not merely appear in it', () => {
  const love = rankPlaylists([
    { id: 1, title: 'Songs to Cry To', nb_tracks: 60, fans: 50_000 },
    { id: 2, title: 'Love Songs', nb_tracks: 80, fans: 40_000 },
    { id: 3, title: 'Lovely Indie', nb_tracks: 40, fans: 9000 },
    { id: 4, title: 'Best Love Songs Ever Made For Long Night Drives With Friends', nb_tracks: 90, fans: 40_000 },
  ], 'Love Songs');
  assert.deepEqual(love.map(playlist => playlist.id), [2, 4]);
  const country = rankPlaylists([
    { id: 1, title: 'Country Hits', nb_tracks: 100, fans: 300_000 },
    { id: 2, title: 'Big Country Road Trip', nb_tracks: 50, fans: 1000 },
    { id: 3, title: 'Top Pop', nb_tracks: 50, fans: 900_000 },
  ], 'Country');
  assert.deepEqual(country.map(playlist => playlist.id), [1, 2]);
});
