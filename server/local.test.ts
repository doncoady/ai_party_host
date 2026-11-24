import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalLibrary, enrichTrack, matchesTheme, parseSongFilename, upsertEnv } from './local.ts';
import { readFile } from 'node:fs/promises';

test('file names are parsed into artist/title', () => {
  assert.deepEqual(parseSongFilename('/music/80s/03 - a-ha - Take On Me.mp3'), { artist: 'a-ha', title: 'Take On Me' });
  assert.deepEqual(parseSongFilename('/music/Take On Me.mp3'), { artist: '', title: 'Take On Me' });
});

test('.env upsert replaces existing keys and appends new ones without touching the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'env-'));
  try {
    const file = join(root, '.env');
    await writeFile(file, 'GEMINI_API_KEY=abc\n# LOCAL_SONGS_DIR=/old\nPORT=3000\n');
    await upsertEnv(file, { LOCAL_SONGS_DIR: '/music', PREFER_LOCAL_MEDIA: 'true' });
    const text = await readFile(file, 'utf8');
    assert.equal(text, 'GEMINI_API_KEY=abc\nLOCAL_SONGS_DIR=/music\nPORT=3000\nPREFER_LOCAL_MEDIA=true\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('themes match folders, tags and decades', () => {
  assert.equal(matchesTheme('The 80s', { relPath: '80s/a-ha - Take On Me.mp3' }), true);
  assert.equal(matchesTheme('eighties', { relPath: 'misc/song.mp3', year: 1984 }), true);
  assert.equal(matchesTheme('Disco', { relPath: 'misc/song.mp3', genre: 'Disco' }), true);
  assert.equal(matchesTheme('Disney movies', { relPath: 'Disney/Frozen/Let It Go.mp3' }), true);
  assert.equal(matchesTheme('Hip hop', { relPath: '80s/a-ha - Take On Me.mp3', genre: 'Pop' }), false);
  assert.equal(matchesTheme('my music', { relPath: 'anything.mp3' }), true);
});

test('the library indexes the configured folder, persists it to .env, and infers themes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-'));
  try {
    await mkdir(join(root, 'songs', 'Country'), { recursive: true });
    for (const name of ['Dolly Parton - Jolene', 'Johnny Cash - Ring of Fire', 'Shania Twain - Man I Feel Like a Woman', 'Garth Brooks - Friends in Low Places']) {
      await writeFile(join(root, 'songs', 'Country', `${name}.mp3`), 'x');
    }
    await writeFile(join(root, 'songs', 'Oasis - Wonderwall.mp3'), 'x');
    const envFile = join(root, '.env');
    const library = new LocalLibrary(join(root, 'cache'), envFile, { autoEnrich: false });
    await library.updateSettings({ localSongsDir: join(root, 'songs'), preferLocal: true });
    const status = library.status();
    assert.equal(status.songs, 5);
    assert.deepEqual(status.themes, ['Country'], 'folders with enough songs become prebuild themes');
    assert.match(await readFile(envFile, 'utf8'), /LOCAL_SONGS_DIR=.*songs\r?\nPREFER_LOCAL_MEDIA=true/);
    const tracks = library.tracksForTheme('country');
    assert.equal(tracks.length, 4);
    assert.equal(tracks[0].provider, 'local');
    assert.ok(tracks[0].localPath?.endsWith('.mp3'));
    assert.equal(library.tracksForTheme('my music').length, 5);
    assert.equal(library.tracksForTheme('hip hop').length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog genres stand in for missing tags', async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/search?')) return new Response(JSON.stringify({ data: [{ album: { id: 42 } }] }), { status: 200 });
    if (url.endsWith('/album/42')) return new Response(JSON.stringify({ genres: { data: [{ name: 'Pop' }, { name: 'Dance' }] }, release_date: '1987-07-27' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const info = await enrichTrack('Rick Astley', 'Never Gonna Give You Up', fakeFetch);
  assert.deepEqual(info, { genres: ['Pop', 'Dance'], year: 1987 });
  assert.equal(matchesTheme('pop', { relPath: 'misc/x.mp3', catalogGenres: ['Pop', 'Dance'] }), true);
  assert.equal(matchesTheme('the 80s', { relPath: 'misc/x.mp3', catalogYear: 1987 }), true);
  assert.equal(matchesTheme('the 90s', { relPath: 'misc/x.mp3', catalogYear: 1987 }), false);
  assert.equal(matchesTheme('hip hop', { relPath: 'misc/x.mp3', catalogGenres: ['Rap/Hip Hop'] }), true);
  assert.equal(matchesTheme('electronic', { relPath: 'misc/x.mp3', catalogGenres: ['Electro'] }), true);
});
