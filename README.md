# You Don't Know 80s!

A couch-multiplayer 80s trivia game hosted by an AI voice.

## Gameplay

The host starts as soon as the page opens. Say how many players are joining, then have each player say their name or nickname. No landing page, answer buttons, multiple-choice list, replay controls, or next-turn button interrupt the game.

Each turn follows the same sequence: the host identifies the player and introduces the clue; a two-second song excerpt plays, or the host narrates a movie sound byte; the active player guesses aloud; the host repeats the recognized guess and asks whether it is their final answer; then the host scores the answer and moves on. Players have 20 seconds to guess, with an 8-second warning. Say “yes” to confirm or “no” to change the guess. Correct answers add the question's points; incorrect answers deduct them; unanswered turns score zero.

Background music starts by default and ducks while the host speaks. The microphone and audio settings remain available in the header. Say “play again” at the end to start a new game.

## Requirements

- Node.js 22 or newer (Node.js 24 is recommended)
- A Gemini API key with access to the Gemini Live API and audio generation

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and add your Gemini API key:

   ```dotenv
   GEMINI_API_KEY=your-key
   # Optional; defaults to gemini-3.8-live
   GEMINI_LIVE_MODEL=gemini-3.8-live
   ```

   Keep `.env` local; it is ignored by Git.

3. Start the app:

   ```sh
   npm run dev
   ```

4. Open <http://localhost:3000>.

The live host uses Gemini's bidirectional Live API through a server-side WebSocket proxy at `/ws/live`; the API key never reaches the browser. The browser captures mono 16 kHz PCM with an `AudioWorklet` and plays streamed host audio through the Web Audio API. Microphone access requires a supported browser, microphone permission, and a secure context (localhost is allowed). Short music excerpts and character sound bites use the existing audio endpoints.

Background music and sound effects are prerecorded audio files; the app does not synthesize music or effects at runtime. Song clues are limited to two seconds per turn. Movie sound bytes are narrated by the host; original movie recordings are not bundled with the game. Music and effects can be muted independently of microphone input in the header.

## Audio credits

- “Monkeys Spinning Monkeys” by Kevin MacLeod, used under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). [Track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100185).
- Interface sound effects by Kenney, from the [Interface Sounds pack](https://kenney.nl/assets/interface-sounds), released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).

## Checks

```sh
npm test
npm run lint
npm run build
```
