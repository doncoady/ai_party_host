import { config } from './config.ts';
import { normalizeForCompare, tokenOverlap } from './clips/providers.ts';
import { localLibrary } from './local.ts';

/**
 * Theme → tracks, without a language model.
 *
 * Streaming catalogs already map themes to songs: Deezer's playlist search
 * ("80s hits", "One Hit Wonders", "Disney songs") and artist pages, and iTunes
 * compilation albums. Every result carries a licensed 30-second preview, so a
 * pack can be assembled in a couple of seconds and is playable the moment the
 * previews are cached. A local music folder is used as a fallback (or as the
 * preferred source when configured).
 */
export interface CatalogTrack {
  key: string;
  artist: string;
  title: string;
  previewUrl?: string;
  localPath?: string;
  sourceUrl?: string;
  album?: string;
  year?: number;
  provider: 'deezer' | 'itunes' | 'local';
  /** Popularity hint (Deezer rank, playlist position) used to prefer recognisable songs. */
  popularity: number;
}

export interface CatalogSearchResult {
  tracks: CatalogTrack[];
  sources: string[];
  errors: string[];
}

const SEARCH_TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS || 6000);

async function fetchJson<T>(url: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 ai-party-host', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function trackKey(artist: string, title: string) {
  return `${normalizeForCompare(artist)}|${normalizeForCompare(cleanTitle(title))}`;
}

/** Strips edition noise so "Take On Me (2015 Remaster)" and "Take On Me" are one song. */
export function cleanTitle(title: string) {
  return title
    .replace(/\s*[\(\[][^\)\]]*(?:remaster|remastered|live|version|edit|mix|mono|stereo|feat\.?|ft\.?|from|bonus|demo|radio|single|album|deluxe|explicit|instrumental)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:remaster(?:ed)?(?: \d{4})?|\d{4} remaster(?:ed)?|live.*|radio edit|single version|album version|mono|stereo).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const THEME_STOP = new Set(['the', 'of', 'and', 'a', 'an', 'hits', 'songs', 'music', 'best', 'greatest', 'top', 'mix', 'playlist', 'collection', 'essentials', 'classics']);

export function themeTokens(theme: string) {
  return normalizeForCompare(theme).split(' ').filter(token => token && !THEME_STOP.has(token));
}

/** Expands decade themes so catalog searches hit the common playlist names. */
export function themeQueries(theme: string): string[] {
  const cleaned = theme.trim().replace(/^the\s+/i, '');
  const decade = cleaned.match(/^(?:19|20)?(\d0)s$/i) ?? cleaned.match(/^(eighties|nineties|seventies|sixties|two thousands|noughties)$/i);
  const queries = [cleaned];
  if (decade) {
    const words: Record<string, string> = { sixties: '60s', seventies: '70s', eighties: '80s', nineties: '90s', 'two thousands': '2000s', noughties: '2000s' };
    const short = words[decade[1].toLowerCase()] ?? `${decade[1]}s`;
    queries.push(`${short} hits`, `best of the ${short}`, `${short} pop`);
  } else {
    queries.push(`${cleaned} hits`, `${cleaned} songs`);
  }
  return Array.from(new Set(queries));
}

// ---------------------------------------------------------------- Deezer
interface DeezerPlaylist { id: number; title: string; nb_tracks?: number; fans?: number; link?: string; user?: { name?: string } }
interface DeezerTrack { id: number; title: string; title_short?: string; preview?: string; link?: string; rank?: number; readable?: boolean; artist?: { name?: string }; album?: { title?: string } }
interface DeezerArtist { id: number; name: string; nb_fan?: number }

/**
 * A playlist counts only if its title contains every significant theme word
 * ("Love Songs" → "love"; "Country" → "country"), so "Songs to Cry To" never
 * stands in for love songs. Popular, mid-sized playlists rank first.
 */
export function rankPlaylists(playlists: DeezerPlaylist[], theme: string) {
  const tokens = themeTokens(theme);
  return playlists
    .filter(playlist => (playlist.nb_tracks ?? 0) >= 10)
    .map(playlist => {
      const title = normalizeForCompare(playlist.title).split(' ');
      const titleSet = new Set(title);
      const hits = tokens.filter(token => titleSet.has(token)).length;
      const complete = tokens.length > 0 && hits === tokens.length;
      const size = playlist.nb_tracks ?? 0;
      const fans = Math.log10((playlist.fans ?? 0) + 10);
      const sizeScore = size >= 20 && size <= 300 ? 1 : size > 300 ? 0.4 : 0.6;
      // Short, on-topic titles ("80s Hits") beat long ones that merely mention the theme.
      const focus = Math.max(0, 1 - Math.max(0, title.length - tokens.length - 2) * 0.15);
      return { playlist, complete, score: fans + sizeScore + focus };
    })
    .filter(entry => entry.complete)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.playlist);
}

// Deezer genres: editorial charts and radios give genre themes real songs of the genre,
// not songs that happen to have the genre's name in the title.
interface DeezerGenre { id: number; name: string }
interface DeezerRadio { id: number; title: string }
let genreCache: { at: number; genres: DeezerGenre[] } | null = null;

const GENRE_ALIASES: Record<string, string> = {
  'hip hop': 'rap/hip hop', hiphop: 'rap/hip hop', rap: 'rap/hip hop', 'r b': 'r&b', rnb: 'r&b', soul: 'r&b', electronic: 'electro', edm: 'electro', dance: 'dance',
  'classic rock': 'rock', metal: 'metal', 'heavy metal': 'metal', classical: 'classical', country: 'country', jazz: 'jazz', reggae: 'reggae', latin: 'latino', latino: 'latino',
  pop: 'pop', rock: 'rock', blues: 'blues', folk: 'folk', 'k pop': 'asian music', kpop: 'asian music', afrobeats: 'african music', 'african': 'african music', 'brazilian': 'brazilian music',
};

/** Resolves a theme to a Deezer editorial genre, if it names one ("Pop", "Hip Hop", "R&B", "Country"). */
export async function resolveDeezerGenre(theme: string): Promise<DeezerGenre | null> {
  try {
    if (!genreCache || Date.now() - genreCache.at > 6 * 3600_000) {
      const data = await fetchJson<{ data?: DeezerGenre[] }>('https://api.deezer.com/genre');
      genreCache = { at: Date.now(), genres: (data.data ?? []).filter(genre => genre.id !== 0) };
    }
    return matchGenre(theme, genreCache.genres);
  } catch {
    return null;
  }
}

export function matchGenre(theme: string, genres: DeezerGenre[]): DeezerGenre | null {
  const wanted = normalizeForCompare(theme).replace(/\s+music$/, '');
  const alias = GENRE_ALIASES[wanted];
  return genres.find(candidate => {
    const name = candidate.name.toLowerCase();
    return name === wanted || name === alias || normalizeForCompare(candidate.name) === wanted;
  }) ?? null;
}

/** Editorial genre content: the genre chart plus its radios. Nothing here is matched by title. */
async function deezerGenreTracks(genre: DeezerGenre, errors: string[]): Promise<CatalogTrack[]> {
  try {
    const [chart, radios] = await Promise.all([
      fetchJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/chart/${genre.id}/tracks?limit=100`).catch(() => ({ data: [] as DeezerTrack[] })),
      fetchJson<{ data?: DeezerRadio[] }>(`https://api.deezer.com/genre/${genre.id}/radios`).catch(() => ({ data: [] as DeezerRadio[] })),
    ]);
    const tracks: CatalogTrack[] = (chart.data ?? []).filter(track => track.preview && track.artist?.name).map((track, position) => ({
      key: trackKey(track.artist!.name!, track.title),
      artist: track.artist!.name!,
      title: cleanTitle(track.title_short ?? track.title),
      previewUrl: track.preview!,
      sourceUrl: track.link,
      album: track.album?.title,
      provider: 'deezer' as const,
      popularity: 6 - position * 0.02,
    }));
    const radioTracks = await Promise.all((radios.data ?? []).slice(0, 3).map(radio =>
      fetchJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/radio/${radio.id}/tracks?limit=50`).then(data => data.data ?? []).catch(() => [] as DeezerTrack[]),
    ));
    radioTracks.flat().forEach((track, position) => {
      if (!track.preview || !track.artist?.name) return;
      tracks.push({
        key: trackKey(track.artist.name, track.title),
        artist: track.artist.name,
        title: cleanTitle(track.title_short ?? track.title),
        previewUrl: track.preview,
        sourceUrl: track.link,
        album: track.album?.title,
        provider: 'deezer',
        popularity: 4 - position * 0.01,
      });
    });
    return tracks;
  } catch (error) {
    errors.push(`deezer genre: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

async function deezerPlaylistTracks(theme: string, wanted: number, errors: string[]): Promise<CatalogTrack[]> {
  const playlists: DeezerPlaylist[] = [];
  for (const query of themeQueries(theme).slice(0, 3)) {
    try {
      const data = await fetchJson<{ data?: DeezerPlaylist[] }>(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(query)}&limit=12`);
      playlists.push(...(data.data ?? []));
    } catch (error) {
      errors.push(`deezer playlists (${query}): ${error instanceof Error ? error.message : error}`);
    }
    if (playlists.length >= 24) break;
  }
  const ranked = rankPlaylists(dedupeBy(playlists, playlist => String(playlist.id)), theme).slice(0, 4);
  const tracks: CatalogTrack[] = [];
  await Promise.all(ranked.map(async (playlist, playlistIndex) => {
    try {
      const data = await fetchJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/playlist/${playlist.id}/tracks?limit=100`);
      (data.data ?? []).forEach((track, position) => {
        if (!track.preview || track.readable === false || !track.artist?.name) return;
        tracks.push({
          key: trackKey(track.artist.name, track.title),
          artist: track.artist.name,
          title: cleanTitle(track.title_short ?? track.title),
          previewUrl: track.preview,
          sourceUrl: track.link,
          album: track.album?.title,
          provider: 'deezer',
          popularity: (track.rank ?? 0) / 1_000_000 + (4 - playlistIndex) * 0.5 - position * 0.01,
        });
      });
    } catch (error) {
      errors.push(`deezer playlist ${playlist.id}: ${error instanceof Error ? error.message : error}`);
    }
  }));
  void wanted;
  return tracks;
}

async function deezerArtistTracks(theme: string, errors: string[]): Promise<CatalogTrack[]> {
  try {
    const data = await fetchJson<{ data?: DeezerArtist[] }>(`https://api.deezer.com/search/artist?q=${encodeURIComponent(theme)}&limit=3`);
    const artist = (data.data ?? []).find(candidate => tokenOverlap(theme, candidate.name) >= 0.99 && tokenOverlap(candidate.name, theme) >= 0.99);
    if (!artist) return [];
    const top = await fetchJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/artist/${artist.id}/top?limit=50`);
    return (top.data ?? [])
      .filter(track => track.preview && track.readable !== false)
      .map((track, position) => ({
        key: trackKey(artist.name, track.title),
        artist: artist.name,
        title: cleanTitle(track.title_short ?? track.title),
        previewUrl: track.preview!,
        sourceUrl: track.link,
        album: track.album?.title,
        provider: 'deezer' as const,
        popularity: 10 - position * 0.1,
      }));
  } catch (error) {
    errors.push(`deezer artist: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

// ---------------------------------------------------------------- iTunes
interface ItunesAlbum { wrapperType?: string; collectionId?: number; collectionName?: string; artistName?: string; trackCount?: number; collectionType?: string }
interface ItunesTrack { wrapperType?: string; trackName?: string; artistName?: string; previewUrl?: string; trackViewUrl?: string; collectionName?: string; releaseDate?: string; trackId?: number }

/**
 * iTunes has no playlist search, but themed compilation albums ("80s Hits",
 * "Country Classics") are a good proxy. Only Various-Artists style compilations
 * whose name contains every theme word are used; single-artist albums and
 * title matches are ignored so "Love Songs" never turns into songs called Love.
 */
async function itunesTracks(theme: string, errors: string[]): Promise<CatalogTrack[]> {
  const tracks: CatalogTrack[] = [];
  const tokens = themeTokens(theme);
  if (!tokens.length) return tracks;
  try {
    const albums = await fetchJson<{ results?: ItunesAlbum[] }>(`https://itunes.apple.com/search?term=${encodeURIComponent(theme)}&entity=album&limit=25`);
    const compilations = (albums.results ?? [])
      .filter(album => {
        if (!album.collectionId || (album.trackCount ?? 0) < 12) return false;
        const name = new Set(normalizeForCompare(album.collectionName ?? '').split(' '));
        if (!tokens.every(token => name.has(token))) return false;
        return /various artists|varios|verschiedene/i.test(album.artistName ?? '') || album.collectionType === 'Compilation';
      })
      .slice(0, 3);
    await Promise.all(compilations.map(async (album, albumIndex) => {
      try {
        const lookup = await fetchJson<{ results?: ItunesTrack[] }>(`https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song&limit=60`);
        (lookup.results ?? []).forEach((track, position) => {
          if (track.wrapperType !== 'track' || !track.previewUrl || !track.artistName || !track.trackName) return;
          tracks.push(toItunesTrack(track, 2 - albumIndex * 0.3 - position * 0.01));
        });
      } catch (error) {
        errors.push(`itunes album ${album.collectionId}: ${error instanceof Error ? error.message : error}`);
      }
    }));
  } catch (error) {
    errors.push(`itunes albums: ${error instanceof Error ? error.message : error}`);
  }
  return tracks;
}

function toItunesTrack(track: ItunesTrack, popularity: number): CatalogTrack {
  const year = track.releaseDate ? Number(track.releaseDate.slice(0, 4)) : undefined;
  return {
    key: trackKey(track.artistName!, track.trackName!),
    artist: track.artistName!,
    title: cleanTitle(track.trackName!),
    previewUrl: track.previewUrl,
    sourceUrl: track.trackViewUrl,
    album: track.collectionName,
    year: Number.isFinite(year) ? year : undefined,
    provider: 'itunes',
    popularity,
  };
}

// ---------------------------------------------------------------- assembly
function dedupeBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * A track whose title or artist contains the theme word ("Pop Smoke", "Pop
 * Muzik" for "Pop") is almost never what the room wanted; it goes to the back
 * of the queue and only plays if nothing else is available.
 */
export function demoteThemeWordTracks(tracks: CatalogTrack[], theme: string) {
  const tokens = themeTokens(theme).filter(token => token.length >= 3 && !/^\d+s$/.test(token));
  if (!tokens.length) return tracks;
  return tracks.map(track => {
    const haystack = new Set(normalizeForCompare(`${track.artist} ${track.title}`).split(' '));
    return tokens.some(token => haystack.has(token)) ? { ...track, popularity: track.popularity - 50 } : track;
  });
}

/** Keeps the pool varied: no artist dominates a Name That Tune round. */
export function balanceByArtist(tracks: CatalogTrack[], maxPerArtist: number) {
  const counts = new Map<string, number>();
  return tracks.filter(track => {
    const artist = normalizeForCompare(track.artist);
    const count = counts.get(artist) ?? 0;
    if (count >= maxPerArtist) return false;
    counts.set(artist, count + 1);
    return true;
  });
}

/**
 * Finds up to `wanted` distinct tracks for a theme. Online catalogs are
 * preferred unless the local library is configured as preferred; local files
 * always fill in when online sources come up short or are unreachable.
 */
export async function findTracksForTheme(theme: string, wanted: number, exclude: Set<string> = new Set()): Promise<CatalogSearchResult> {
  const errors: string[] = [];
  const sources: string[] = [];
  const settings = localLibrary.getSettings();
  // Preferred local files outrank anything online; otherwise they fill in behind the catalogs.
  const local = localLibrary.tracksForTheme(theme).map(track => ({ ...track, popularity: track.popularity + (settings.preferLocal ? 100 : -100) }));
  if (local.length) sources.push(`local:${local.length}`);

  let online: CatalogTrack[] = [];
  if (config.mode !== 'mock') {
    // Genre themes use editorial genre content only; playlists/artists/compilations cover everything else.
    const genre = await resolveDeezerGenre(theme);
    if (genre) {
      online = await deezerGenreTracks(genre, errors);
      if (online.length) sources.push(`deezer-genre(${genre.name}):${online.length}`);
    }
    if (online.length < wanted) {
      const [playlists, artist, itunes] = await Promise.all([
        deezerPlaylistTracks(theme, wanted, errors),
        genre ? Promise.resolve([] as CatalogTrack[]) : deezerArtistTracks(theme, errors),
        itunesTracks(theme, errors),
      ]);
      if (playlists.length) sources.push(`deezer-playlists:${playlists.length}`);
      if (artist.length) sources.push(`deezer-artist:${artist.length}`);
      if (itunes.length) sources.push(`itunes:${itunes.length}`);
      online = [...online, ...artist, ...playlists, ...itunes];
    }
  }

  const pool = demoteThemeWordTracks(dedupeBy([...local, ...online], track => track.key), theme)
    .filter(track => !exclude.has(track.key))
    .sort((a, b) => b.popularity - a.popularity);
  const tracks = balanceByArtist(pool, Math.max(2, Math.ceil(wanted / 6))).slice(0, wanted);
  return { tracks, sources, errors };
}
