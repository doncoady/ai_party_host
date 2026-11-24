import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './server/app.ts';
import { config, describeCapabilities } from './server/config.ts';
import { createLiveServer, handleUpgrade } from './server/live.ts';
import { packService } from './server/packs.ts';
import { localLibrary } from './server/local.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function start() {
  const app = createApp();
  const server = createServer(app);
  const live = createLiveServer();
  server.on('upgrade', (request, socket, head) => handleUpgrade(live, request, socket, head));

  if (!config.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(config.port, '0.0.0.0', () => {
    const caps = describeCapabilities();
    console.log(`[AI Party Host] http://0.0.0.0:${config.port} mode=${caps.mode} gemini=${caps.hasApiKey} ffmpeg=${caps.ffmpeg} yt-dlp=${caps.ytdlp} songs=${caps.songProviders.join('>')}`);
    // Start building packs immediately: built-ins plus any featured themes, and again
    // whenever the media sources change.
    // Featured themes plus every genre/folder the local collection covers.
    const prebuild = () => void packService.prebuild([...config.prebuildThemes, ...localLibrary.impliedThemes()], 3);
    void localLibrary.init().then(() => {
      if (config.prewarmBuiltins) setTimeout(prebuild, 1000);
      localLibrary.onChange(prebuild);
    });
  });
}

void start();
