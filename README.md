# You Don't Know 80s!

A local, couch-multiplayer 80s trivia game with an AI host, voice input, and audio clips.

## Requirements

- Node.js 22 or newer (Node.js 24 is recommended)
- A Gemini API key for generated host speech and AI banter (optional; the game remains playable without it)

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and add your Gemini API key:

   ```dotenv
   GEMINI_API_KEY=your-key
   ```

   Keep `.env` local; it is ignored by Git.

3. Start the app:

   ```sh
   npm run dev
   ```

4. Open <http://localhost:3000>.

The app uses the browser's Web Speech API for microphone recognition, which requires a supported browser and microphone permission. Generated host audio uses Gemini TTS when `GEMINI_API_KEY` is configured; without a key, host lines remain available as on-screen text.

## Checks

```sh
npm test
npm run lint
npm run build
```
