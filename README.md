# AI Party Host — Name That Tune

A couch-multiplayer, voice-driven **Name That Tune** show hosted by a live AI voice. Pick a music theme out loud — a genre, a decade, an artist — and the host cues up real song clips, runs the whole game by ear, and roasts accordingly.

```
[ "Let's play country" ] ──▶ 1. Find songs   (Deezer playlists/genres/artists · iTunes compilations · your music folder)
                          ──▶ 2. Fetch audio  (licensed 30-second previews, or local files)
                          ──▶ 3. Cut the clip (FFmpeg: song opening, fades, loudness normalisation)
                          ──▶ 4. Play         (Web Audio, cached on disk, pre-loaded a question ahead)
```

No language model is involved in building packs, so a theme is playable within seconds. Caching starts at launch for featured themes, the instant a theme is chosen for everything else, and keeps running in the background through the game. A round only uses clips that are actually cached, and no clip is ever repeated in a rematch.

## How a game goes

1. **Theme.** Say a genre, decade or artist: *"country"*, *"the eighties"*, *"Fleetwood Mac"*, *"surprise me"*. Stack settings in one breath: *"hip hop, three players, hard mode, ten seconds per turn"*. The theme stays front and centre on screen for the whole game.
2. **Players.** Say how many (one to four), then each player says a name or nickname.
3. **Turns.** "*Alice, name that tune for $1,000.*" → a clip from the **opening** of the song plays (intros rarely give away the title) → say the song or the artist. The screen shows what was heard; the host only asks "*Final answer, Alice?*" (*yes* / *no, it's …*). Say *"X, final answer"* to skip confirmation. Per turn: one *"hint"* (clock paused) and one *"play it again"*.
4. **Scoring.** Correct adds the question's value, wrong subtracts it, passes and timeouts score zero, back-to-back correct answers earn a 50 % streak bonus.
5. **End.** Fanfare, scoreboard, and *"play again"* (fresh songs, same theme) or *"new theme"*.

Say *help*, *scoreboard*, *next*, *pass*, *turn off the music*, or *change the theme to …* at any time. Every voice command has a GUI twin: the Settings drawer, setup buttons and theme pills, and a *"type it"* box for quiet rooms, blocked microphones and accessibility.

## Requirements

- Node.js 22 or newer
- **ffmpeg** on `PATH` (clip cutting, loudness normalisation, local-file tags)
- Optional: a Gemini API key for the live host voice, TTS and semantic answer judging. Without it the game still runs: browser speech recognition, browser speech synthesis, subtitles.
- Optional: **yt-dlp** on `PATH` for full-length song sources (real intros) instead of previews

## Run locally

```sh
npm install
cp .env.example .env          # add GEMINI_API_KEY; optionally LOCAL_SONGS_DIR
npm run dev                   # http://localhost:3000
npm run prebuild-packs        # optional: cache featured themes (and your local genres) ahead of the party
```

Other modes: `npm run dev:mock` (offline demo: fake live host, synthetic clips), `npm run build && npm start` (production).

### Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | – | Live host voice, TTS, answer judge |
| `GEMINI_LIVE_MODEL` / `GEMINI_TEXT_MODEL` / `GEMINI_TTS_MODEL` | `gemini-3.8-*` | Model overrides |
| `HOST_VOICE` | `Kore` | Prebuilt voice for the host |
| `PREBUILD_THEMES` | `The 80s,The 90s,Pop,Rock,Hip Hop,Country` | Packs + clips built at launch (plus every theme your local music covers) |
| `LOCAL_SONGS_DIR` | – | Local music folder (`Artist - Title.mp3`). Subfolders, tags and catalog-looked-up genres/years become themes. The Settings drawer writes this line. |
| `PREFER_LOCAL_MEDIA` | `false` | Local files outrank online previews |
| `CLIP_PROVIDERS` | `itunes,deezer` | Searching providers for curated entries without a preview URL (`ytdlp` opt-in) |
| `CLIP_ANALYSIS` | `auto` | Hook mode only: Gemini for full tracks, loudness scan for previews |
| `CLIP_CONCURRENCY` | `4` | Parallel clip jobs |
| `PARTY_HOST_CACHE_DIR` | `.cache` | Packs, clips, TTS renders and the local index persist here |
| `PARTY_HOST_MODE` | `live` | `mock` swaps Gemini and the catalogs for deterministic fakes |

## Architecture

```
server.ts                 entry: Express + WebSocket + Vite/static; prebuilds packs at launch
server/
  config.ts               env, binaries, provider order, mock mode
  gemini.ts               text / JSON / TTS helpers
  live.ts                 Gemini Live proxy (VAD tuning, context compression, GoAway) + deterministic mock session
  catalog.ts              theme → tracks: Deezer playlists (title must contain the theme words), genre charts/radios,
                          artist top tracks; iTunes Various-Artists compilations; local library
  local.ts                local music folder: .env-backed settings, index (file names + ID3 tags), theme inference
  packs.ts                packs: built-in → cache → catalog → mock; pool extension with `exclude`; prebuild
  clips/
    providers.ts          preview (exact URL), local file, iTunes, Deezer, yt-dlp, mock
    analyze.ts            clip position: song opening (default) or loudest hook (loudness scan / Gemini)
    ffmpeg.ts             probe, first-audible scan, slice with fades + loudnorm, loudest-window scan
    pipeline.ts           prioritised concurrent jobs, request-hash dedupe, disk cache, status API
  app.ts                  REST: /api/theme/pack, /api/clips, /api/judge, /api/host-speak (rate-limit aware, disk cached), /api/settings
shared/packs/             curated 80s and 90s packs shared by server and client
src/
  game/engine.ts          pure state machine: (state, event) → { state, effects }; rounds planned from cached clips
  game/commands.ts        voice command parser; genre theme pills
  game/rules.ts           fuzzy spoken-answer matching, scoring, ranks
  game/hostLines.ts       every host line + predicted lines for pre-rendering
  app/store.ts, effects.ts, harness.ts
  audio/speechHost.ts     host voice ladder: cached TTS → Gemini Live → TTS → browser speech → subtitles
  audio/mediaEngine.ts    SFX, music (ducked for the host, cut while listening), clip fetch/preload/playback
  speech/liveVoice.ts     Live socket client: PCM capture, utterance assembly, audio scheduling, patient reconnects
  speech/voiceInput.ts    transport ladder: Gemini Live → browser speech (bridges while Live is down) → typed
  components/             header, theme banner, voice console, setup, question, reveal, game over, settings
```

**Keeping the show moving.** The game boots on whatever voice transport is ready within ~2.5 s and upgrades to Gemini Live when it connects; browser speech recognition stands in whenever Live is reconnecting. Host lines use a fallback ladder — pre-rendered TTS (the next two turns are rendered ahead), the live model, a TTS request (skipped while a 429 back-off is active), browser speech synthesis, subtitles — with bounded watchdogs: a live turn that produces no audio within 4.5 s is handed down the ladder, and a dropped socket completes pending lines immediately. Music is ducked while the host talks and cut entirely while the room is expected to answer.

**Genre themes are editorial, never title matches.** A theme that names a Deezer genre ("Pop", "Country", "Hip Hop", "R&B"…) is served from that genre's editorial chart and radios; playlist search only backs it up and must contain every theme word in the playlist *title*; iTunes only contributes Various-Artists compilations named for the theme. Any track whose own title or artist contains the theme word ("Pop Smoke" for Pop) is demoted to the back of the pool. Local files are matched by folder name and tags **and** by genres/years looked up from the Deezer catalog after indexing, so untagged collections still land in the right themes.

**Clips.** Song clips are cut from the first audible moment of the source by default. Online previews are 30-second windows chosen by the catalog, so "opening" means the start of that window; local files and yt-dlp sources give the real intro. Settings → "Song clips play" switches to the loudest hook. Each clip shows its source (**Online · Deezer/iTunes** or **Local file**).

## Sound design

Game-show effects in `public/audio/sfx` are synthesized by `scripts/generate-sfx.py` (numpy + ffmpeg): cash-register "correct", buzzer with a crowd "aww", sad-trombone timeout, arcade buzz-in, alarm-style timer warning, drum roll, applause with cheers, brass fanfare with timpani, stingers and transitions. Regenerate with `npm run sfx`. Background music is Kevin MacLeod's "Monkeys Spinning Monkeys" (CC BY 4.0); see `public/audio/ATTRIBUTION.txt`. Song previews are fetched on demand from the catalogs for personal, in-home play and are never bundled with the app.

## Tests

```sh
npm run lint        # TypeScript
npm test            # unit: engine, parser, matcher, catalog, local library, packs, pipeline (real ffmpeg), live helpers
npm run test:e2e      # core Playwright suite (~2 min): API + pipeline contracts, voice setup, GUI setup, one full game, socket fallback
npm run test:e2e:all  # + extended suite: presets, hints, streaks, rematches, commands, noise/echo, autoplay, phone layout, media folder
npm run test:all
```

Both projects build the app and boot the server in mock mode (`PARTY_HOST_MODE=mock`), which ignores the developer's `.env` media/provider settings and writes test settings to `.cache-e2e/.env`, so a configured `.env` never changes what the suite does.
