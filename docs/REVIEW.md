# Architecture & gameplay review

Findings from reviewing the original "You Don't Know 80s!" build, and what changed. Severity: **bug** (broke play), **flow** (hurt the experience), **arch** (maintainability / performance).

## Flow-breaking bugs in the original

| # | Finding | Fix |
| --- | --- | --- |
| 1 | **bug** — With the live host, `HostEngine` fired `onEnd` immediately after `speak()`: the subscriber branch `!isOutputting && !outputTranscript && currentSubtitle && liveOnEnd` was true before the model produced anything, so song clips started while the host was still introducing the question and the turn clock began early. | Speech completion is now tracked per *turn id* (`liveVoice.sendText` → `onTurn`), and only fires after the model's audio has actually drained from the output buffer. A watchdog sized by reading time guarantees exactly one completion even if the model returns nothing. |
| 2 | **bug** — `matchVoiceToOption` matched any ≥4-letter word from any option, in option order. *"I'll take Duran Duran"* matched **a-ha** through the word "take"; "just" and "wake" were also answers. | New scorer: full-phrase > all-significant-terms (fuzzy, speech-to-text tolerant) > unique distinctive term, with a stop-word list and per-pack spoken aliases (`acceptedAnswers`). Covered by unit tests. |
| 3 | **bug** — A wrong answer that did not textually match any option was treated as "I didn't catch that", so players could guess forever without penalty. | Unmatched answers are *answers*: they go to the Gemini judge (semantic match, e.g. "Marty's doctor friend" → Doc Brown), then to confirmation, and count as wrong if unrecognised. Fillers ("um", "uh") are ignored silently. |
| 4 | **bug** — The speech `onEnd` for the reveal could be lost if any other line interrupted it (e.g. a future "scoreboard" command), leaving the game stuck in the reveal forever (30 s hard timer only). | Effects carry `seq`; informational lines re-attach the phase's continuation; stale completions are ignored. |
| 5 | **bug** — Vite's late dependency discovery (`canvas-confetti` loading at game over) triggers a full page reload in dev, wiping the session. | `optimizeDeps.include` pre-bundles everything; the E2E suite runs the production build. |
| 6 | **bug** — `/api/character-quote` accepted unbounded text and the quote/song caches were unbounded. | Validation + bounded caches; song clips now live on disk with a hash key. |

## Gameplay flow

| Finding | Change |
| --- | --- |
| Eight questions for 2–4 players meant unequal turns. | Questions = `rounds × players`, always fair; rounds are configurable by voice or GUI. |
| The 8-second warning was a *spoken* line, which muted the microphone for several seconds of the player's remaining time. | Warning is a sound effect plus ticks in the last five seconds; the mic stays open. |
| The confirmation clock started while the host was still asking "final answer?". | The clock starts when the host finishes; saying **"X, final answer"** skips confirmation; **"no, it's Y"** replaces the answer in one breath. |
| No replay, no pass, no scoreboard, no help. | One replay per turn (clock parks while it plays), pass, scoreboard, help, next, mute/music/SFX by voice, mid-game theme change (keeps the roster), play again with rotated questions, new theme. |
| Nothing rewarded momentum. | 50% streak bonus for consecutive correct answers, with its own stinger. |
| Results could vanish before anyone read them. | Reveal screens dwell at least 3.5 s; the header keeps the last host line visible. |
| Autoplay policies silently blocked the opening line. | A one-tap start overlay appears only when the audio context boots suspended. |
| Microphone denied = dead app. | Transport ladder: Gemini Live → browser Web Speech → typed box (always visible). |
| Live socket drop = dead app. | Exponential-backoff reconnect; typed input keeps working meanwhile; the theme persona is re-sent on reconnect. |
| Theme persona changes required a reconnect (which lost speech). | Theme is sent inline as `[CONTEXT theme="…"]` on the next host line. |

## Sound

The original shipped four Kenney UI blips (click, confirm, error, maximize). The game now has an 18-effect game-show set (buzz-in, lock-in, correct chime, wrong buzzer, timeout "wah-wah", ticks, timer warning, drum roll, applause, fanfare, intro sting, theme sparkle, player join, game start riser, clip whoosh, transition, streak, scoreboard), synthesized deterministically by `scripts/generate-sfx.py` so they are license-free and tweakable. Effects, host voice and clips share one output bus with music ducking.

Authentic clips moved from eight hard-coded iTunes preview URLs to a provider pipeline (yt-dlp → iTunes; MyInstants → yt-dlp for sound bites) with Gemini picking the most recognisable moment and FFmpeg slicing/normalising, cached on disk, range-served, preloaded one question ahead, with TTS character voices as the last resort for sound bites.

## Architecture

| Finding | Change |
| --- | --- |
| One 400-line `App.tsx` held state, timers, audio orchestration and copy; `askQuestion` was recreated every render and captured stale closures. | Pure reducer (`engine.ts`) + effect runner + external store. Every transition is unit-tested; React only renders. |
| `voiceBuzzer.ts` (Web Speech) was dead code next to `liveVoice.ts`. | It is the second rung of the `voiceInput` facade. |
| Server was a single file mixing routes, caches, model calls and the WS proxy; no way to run without a key. | Modules under `server/`, `PARTY_HOST_MODE=mock` with a deterministic live session, synthetic clips and packs. |
| No tests beyond three matcher cases. | 55 unit tests + 35 Playwright E2E tests. |
| Playback used separate `AudioContext`s (16 kHz capture context also played 24 kHz host audio). | Dedicated 16 kHz capture context; one shared output context with gain buses. |
| Host line copy was scattered through components and the reducer. | `hostLines.ts` holds every line plus improv directions for the live model. |

## Known limits / next steps

- yt-dlp and MyInstants are unofficial sources; availability varies and the pipeline degrades to previews / TTS. Consider licensed catalog APIs for production.
- Gemini clip analysis sends a 32 kbps proxy of the full track (≈1.5 MB for 5 minutes); long sources are truncated at `CLIP_MAX_SOURCE_SECONDS`.
- The Web Speech fallback is Chrome-only and English; the Live path is language-agnostic.
- Packs are generated once per theme+difficulty and cached; a "regenerate" command would be a cheap addition.

## Field-test round 2 (live play feedback)

| Report | Root cause | Fix |
| --- | --- | --- |
| Song clips never played; clues were generated speech | yt-dlp was the first song provider (30–90 s, often blocked), Gemini analysis added seconds per clip, and on any failure the host *read the question instead*. | Licensed preview catalogs first (iTunes Search API, Deezer), local loudness analysis for previews, prioritised/concurrent jobs, and **no synthesized stand-ins**: a failed clip swaps for a cached one or is skipped. |
| Clips slow to load | Jobs started only when the pack arrived and ran unprioritised; nothing was cached ahead of play. | Caching starts when the theme is chosen (before players/names), songs first; built-in packs pre-warm at boot; the game starts when round one is cached and keeps caching later rounds in the background; the UI shows cache progress throughout setup. |
| Silence counted as a guess | Gemini Live input transcription arrives in *fragments* and defaults to high start-of-speech sensitivity; fragments were dispatched as whole answers. | Fragments are assembled until `finished`/900 ms quiet; VAD set to low sensitivity with 900 ms end-of-speech; hallucination phrases, punctuation-only and host-echo (verbatim 4-gram) transcripts are discarded; echo guard extended. |
| "One hit wonders" became the 80s; themes "unavailable" | Single 12-question generation call could fail/timeout and the client silently fell back to the default pack. | Three parallel batches (8 songs, 8 quotes, 4 trivia) with smaller retries, 16k output tokens, lenient sanitising, disk cache; failures are spoken with the reason and the player picks again. |
| Host intros too long | Every question opened with a multi-sentence clue + category + question. | "*Alice, name that tune for $1,000.*" — the clue is now an optional *hint*; reveals are scripted one-liners; rematch/intro lines trimmed; reveal dwell 2.5 s. |
| Rounds should be Name That Tune / Who Said It | Types were mixed per question. | Rounds are planned per kind from cached clips, alternating tune/quote; trivia only as a last resort. Built-in packs carry 8 songs + 8 quotes each. |
| Host speech intermittent/broken | Unsolicited model replies to room audio played over the show; sessions expired (no context compression, no GoAway handling); back-to-back lines cut each other off; no jitter buffer. | Audio is only played for turns the game requested; sliding-window context compression + proactive reconnect on GoAway; a speech queue where flow lines wait and only player-triggered lines interrupt; 180 ms jitter buffer on the first chunk of each turn. |

## Field-test round 3

| Report | Root cause | Fix |
| --- | --- | --- |
| Packs failed for every non-built-in theme, slowly | Pack building depended on a Gemini generation call (schema-bound, 12 items, 90 s client timeout) that evidently did not complete in the field. | Packs are now built from catalogs that already map themes to songs (Deezer playlists/artist top tracks, iTunes song/compilation search) plus local folders — no model involved, every call time-boxed (≈14 s worst case), a single in-flight build per theme, and a spoken failure reason within seconds. |
| Simplify: Name That Tune by default | Rounds mixed songs and sound bites. | Default game is song clips only; a GUI/voice toggle adds optional **Who Am I?** sound-byte rounds (curated, local folder, or model-suggested quotes). |
| Local collections as fallback | None existed. | Settings → Media sources: songs and sound-byte folders, "prefer local"; indexed by file name + ID3 tags, matched by folder/genre/decade; saving re-indexes and rebuilds packs. |
| Build packs at launch / install | Only built-ins pre-warmed. | `PREBUILD_THEMES` built at boot and after media changes; `npm run prebuild-packs` for install time. |
| Host lagging / out of sync | Every line went through the Live model (1–3 s to first audio, can decline to speak). | Scripted lines use TTS, pre-rendered for the next two turns and cached; Live is transcription + intro/outro improv only; reveal dwell 1.5 s. Fixes the silent "player 2, say your name" too. |
| Brief confirmation | "I heard X. Final answer, Alice? Say yes…" | "Final answer, Alice?" — the heard answer is on screen. |
| Rematch repeated clips | Used questions were only de-prioritised. | Never reused; the pool (24 songs) is extended from the catalogs with `exclude` when it runs low, and the show pauses for fresh clips rather than repeating. |

## Field-test round 4

| Report | Root cause | Fix |
| --- | --- | --- |
| "Love Songs" → songs titled Love; "Country" → artists named Country | iTunes *song* search matched theme words against titles/artists; playlist ranking accepted partial title overlap. | Song/title search removed as a theme source; Deezer playlists must contain every theme word in the title; Deezer genre charts/radios added for genre themes; iTunes limited to Various-Artists compilations named for the theme. |
| Presets not mode-aware | One preset list. | Tune themes (decades, genres, love songs…) always; franchise/sound-byte themes only when Who Am I is on; "surprise me" draws from tune themes. |
| No source indicator | – | Online · Deezer/iTunes/MyInstants or Local file badge on the question card and reveal; online/local counts in the prep meter. |
| Gemini Live unreliable at peak | Boot waited up to 20 s on the socket; reconnect gave up after 3 tries; nothing transcribed meanwhile. | Boot proceeds after 2.5 s on browser speech/typed; Web Speech bridges while Live is down; reconnect backoff then patient retries forever; host lines are TTS so narration continues. |
| Clips sing the title | Loudest-window (chorus) selection. | Clips cut from the song opening by default (first audible moment); hook mode available in Settings/voice. |
| MyInstants "no match" | Generic UA, single query, silent failures. | Browser UA, five query variants per quote (full line, opening, ending, character + keyword, character), two search URLs, detailed diagnostics in the log (HTTP status, bot-protection, empty parse). |

## Field-test round 5

| Report | Change |
| --- | --- |
| Sound bytes unreliable → remove the mode | Removed end to end: sound-byte question type, MyInstants/yt-dlp quote sources, local sound-byte folder, Who Am I toggle, lines, tests and docs. The game is exclusively Name That Tune; built-in packs are 8 songs each and extend from the catalogs. |
| Theme pills should be music genres | Pills are genres (Pop … Love Songs, One-Hit Wonders); decades/artists still work by voice or typing; "surprise me" draws from genres + decades. |
| Clips still sometimes sing the title | Clips now start at the first audible moment of the source (no loudness/hook selection unless "hook" mode is chosen). Note: online previews are 30-second windows chosen by the catalog, so the true intro is only available from local files or yt-dlp — both now take priority when present. |
| Show the theme more prominently | Persistent theme banner under the header (theme + round), theme in the round pill, and in the header. |
| Local path in `.env` | `LOCAL_SONGS_DIR` / `PREFER_LOCAL_MEDIA` are read from `.env`; the Settings drawer writes them back (`upsertEnv`), re-indexes and rebuilds. |
| prebuild-packs should use local files | Local tracks join every theme they match; the local library's folders and genre tags become prebuild themes automatically (server launch and `npm run prebuild-packs`). |
| Gemini TTS rate limits | Server: concurrency-limited queue, identical-line dedupe, disk cache, 429 detection with `Retry-After`. Client: honours back-off, prefetch is paced (one at a time, 600 ms apart), and the ladder continues with the live host, then browser speech synthesis, then subtitles. |
| Live preferred, flow paramount | Cached TTS plays instantly; otherwise Live is tried first for uncached lines; a live turn with no audio in 4.5 s is handed down; a dropped socket completes pending turns at once (this was the E2E failure: the game sat in INTRO on a ~30 s watchdog). |
| YDKJ-calibre effects | Cash-register correct, buzzer + crowd "aww", sad trombone, arcade buzz-in, alarm warning, timpani/crash fanfare, cheers in the applause, combo streak. |
| Recognition accuracy | Music is cut (not just ducked) whenever the room is expected to speak; echo guard and utterance assembly unchanged. Headphones or a speaker away from the mic remain the biggest practical win. |

## Overall review — remaining opportunities

Implemented in this round are the items above. Worth doing next, roughly in order of player impact:

1. **True song intros online.** Previews are catalog-chosen windows. Options: opt-in yt-dlp (already supported, slow), or a licensed full-track API. Until then, local files give the best "guess the intro" experience — the prebuild now caches every genre your folder covers.
2. **Answer judging without Gemini.** The semantic judge is the last Gemini text dependency on the critical path. A local fuzzy pass already handles aliases; adding phonetic matching (Double Metaphone) for artist names would close most of the gap when the judge is rate-limited.
3. **Multi-device buzzers.** The engine's event model (transcripts + commands, sequence-tagged effects) would accept a phone-as-buzzer WebSocket client with no changes to the reducer.
4. **Pack quality signals.** Catalogs occasionally return remixes or karaoke versions; `cleanTitle` strips the common markers and artist balancing keeps variety, but a "report this clip" voice command that marks a question failed (and never reuses it) would be cheap.
5. **Scoring depth.** Speed bonus (answer within 5 s) and a "name both song and artist" double-score option are one reducer change each.
6. **Observability.** `/api/health` exposes capabilities; a `/api/stats` with pipeline timings, cache hit rates and TTS back-off state would make field reports far easier to diagnose.

## Field-test round 6

| Report | Root cause | Fix |
| --- | --- | --- |
| 21 E2E failures, "itunes: no match" for mock songs | `.env`'s `CLIP_PROVIDERS=itunes,deezer` overrode the mock provider, so no clip ever cached and every game-flow test timed out. | Mock mode now forces the mock provider, ignores yt-dlp and `LOCAL_SONGS_DIR` from the environment, and writes test settings to `.cache-e2e/.env`. |
| "Pop" → songs with Pop in the title/artist | Playlists titled with the word but about something else ("Iggy Pop", "Pop Smoke essentials"); single-artist iTunes albums with ≥18 tracks. | Genre themes are served from Deezer's editorial genre chart + radios; iTunes limited to Various-Artists compilations; any track whose title/artist contains the theme word is demoted to the back of the pool. |
| Local songs may have no/incorrect tags | Matching relied on folder names and ID3 tags. | After indexing, each untagged track is looked up on Deezer (artist + title → album → genres, year), throttled and cached in the index; folder names, tags and catalog genres all feed theme matching and prebuild themes. |
| E2E too slow/extensive | 41 serial-ish tests in one project. | Split into **core** (14 tests, ~2 min, `npm run test:e2e`) and **extended** (`npm run test:e2e:all`); 3 workers, 60 s per-test timeout. |
