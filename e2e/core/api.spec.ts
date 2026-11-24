import { expect, test } from '@playwright/test';
import WebSocket from 'ws';

/** Request-level coverage of the server: packs, the clip pipeline, judge, speech fallbacks and the live socket. */
test.describe('server API', () => {
  test('health reports mock mode and pipeline capabilities', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.mode).toBe('mock');
    expect(body.hasApiKey).toBe(false);
    expect(typeof body.ffmpeg).toBe('boolean');
    expect(Array.isArray(body.songProviders)).toBe(true);
  });

  test('built-in packs resolve instantly and attach clip jobs', async ({ request }) => {
    const response = await request.post('/api/theme/pack', { data: { theme: 'the 80s', difficulty: 'medium', clipSeconds: 3 } });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.origin).toBe('builtin');
    expect(body.pack.id).toBe('builtin-80s');
    expect(body.pack.questions).toHaveLength(8);
    const song = body.pack.questions.find((question: { type: string }) => question.type === 'SONG_CLIP');
    expect(song.clip.id).toMatch(/^[a-f0-9]{16}$/);
  });

  test('unknown themes produce a deterministic mock pack and honour exclusions', async ({ request }) => {
    const response = await request.post('/api/theme/pack', { data: { theme: 'Pirate Shanties', difficulty: 'hard', clipSeconds: 4 } });
    const body = await response.json();
    expect(body.origin).toBe('mock');
    const excluded = await (await request.post('/api/theme/pack', { data: { theme: 'Pirate Shanties', difficulty: 'hard', clipSeconds: 4, exclude: ['mock-1', 'mock-2'] } })).json();
    expect(excluded.pack.questions.some((question: { id: string }) => question.id === 'mock-1')).toBe(false);
    expect(body.pack.questions[0].options[0]).toBe('Alpha');
    expect(body.pack.questions[8].options[0]).toBe('India');
    const batch = await request.get(`/api/clips/status?ids=${body.pack.questions.slice(0, 3).map((question: { clip: { id: string } }) => question.clip.id).join(',')}`);
    expect(batch.ok()).toBeTruthy();
    expect((await batch.json()).clips).toHaveLength(3);
  });

  test('media settings are validated and persisted', async ({ request }) => {
    expect((await request.put('/api/settings', { data: { preferLocal: 'yes' } })).status()).toBe(400);
    const saved = await request.put('/api/settings', { data: { localSongsDir: '/definitely/not/here', preferLocal: false } });
    expect(saved.ok()).toBeTruthy();
    const body = await saved.json();
    expect(body.settings.localSongsDir).toBe('/definitely/not/here');
    expect(body.songsDirExists).toBe(false);
    expect(body.songs).toBe(0);
    expect(body.envFile).toMatch(/\.env/);
    await request.put('/api/settings', { data: { localSongsDir: '' } });
  });

  test('pack requests are validated', async ({ request }) => {
    expect((await request.post('/api/theme/pack', { data: { theme: '' } })).status()).toBe(400);
    expect((await request.post('/api/theme/pack', { data: { theme: 'x', difficulty: 'impossible' } })).status()).toBe(400);
    expect((await request.post('/api/theme/pack', { data: { theme: 'x', clipSeconds: 99 } })).status()).toBe(400);
    expect((await request.post('/api/theme/pack', { data: { theme: 'x', exclude: 'nope' } })).status()).toBe(400);
  });

  test('the clip pipeline scrapes, analyses, slices and serves with range support', async ({ request }) => {
    const packResponse = await request.post('/api/theme/pack', { data: { theme: 'Range Test Theme', difficulty: 'medium', clipSeconds: 3 } });
    const { pack } = await packResponse.json();
    const clipId: string = pack.questions[0].clip.id;

    // Poll until the job finishes (mock provider + real ffmpeg).
    let status = 'pending';
    for (let attempt = 0; attempt < 40 && status === 'pending'; attempt++) {
      const statusResponse = await request.get(`/api/clips/${clipId}/status`);
      expect(statusResponse.ok()).toBeTruthy();
      status = (await statusResponse.json()).status;
      if (status === 'pending') await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(status).toBe('ready');
    const meta = await (await request.get(`/api/clips/${clipId}/status`)).json();
    expect(meta.provider).toBe('mock');
    expect(meta.durationSeconds).toBe(3);
    expect(meta.analysis?.method ?? 'loudness').toBeTruthy();
    expect(meta.url).toBe(`/api/clips/${clipId}`);

    const full = await request.get(`/api/clips/${clipId}`);
    expect(full.status()).toBe(200);
    expect(full.headers()['content-type']).toContain('audio/');
    expect(full.headers()['accept-ranges']).toBe('bytes');
    const bytes = await full.body();
    expect(bytes.length).toBeGreaterThan(1000);

    const partial = await request.get(`/api/clips/${clipId}`, { headers: { Range: 'bytes=0-99' } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()['content-range']).toBe(`bytes 0-99/${bytes.length}`);
    expect((await partial.body()).length).toBe(100);

    const bad = await request.get(`/api/clips/${clipId}`, { headers: { Range: 'bytes=999999999-' } });
    expect(bad.status()).toBe(416);
  });

  test('unknown clips return 404', async ({ request }) => {
    expect((await request.get('/api/clips/doesnotexist')).status()).toBe(404);
    expect((await request.get('/api/clips/doesnotexist/status')).status()).toBe(404);
  });

  test('judge degrades gracefully without Gemini and validates input', async ({ request }) => {
    const response = await request.post('/api/judge', { data: { question: 'Q?', options: ['A', 'B', 'C', 'D'], correctIndex: 0, transcript: 'something' } });
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).optionIndex).toBeNull();
    expect((await request.post('/api/judge', { data: { question: 'Q?', options: ['A'], transcript: 'x' } })).status()).toBe(400);
  });

  test('speech endpoints report unavailability cleanly in mock mode', async ({ request }) => {
    expect((await request.post('/api/host-speak', { data: { text: 'hello' } })).status()).toBe(503);
    expect((await request.post('/api/host-speak', { data: { text: '' } })).status()).toBe(400);
    expect((await request.get('/api/nope')).status()).toBe(404);
  });

  test('the live socket rejects cross-origin upgrades and serves same-origin clients', async ({ baseURL }) => {
    const wsUrl = baseURL!.replace(/^http/, 'ws') + '/ws/live';
    const host = new URL(baseURL!).host;

    await new Promise<void>((resolve, reject) => {
      const evil = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example' } });
      evil.on('open', () => reject(new Error('cross-origin socket should not open')));
      evil.on('error', () => resolve());
      evil.on('close', () => resolve());
    });

    const events: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, { headers: { Origin: `http://${host}` } });
      const timer = setTimeout(() => reject(new Error('timed out')), 10_000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'start', theme: 'The 90s' })));
      socket.on('message', raw => {
        const event = JSON.parse(raw.toString());
        events.push(event);
        if (event.type === 'ready') {
          socket.send(JSON.stringify({ type: 'text', text: 'Hello players', mode: 'say' }));
          socket.send(JSON.stringify({ type: 'debug_transcript', text: 'two players' }));
        }
        if (event.type === 'turn_complete' && events.some(entry => entry.type === 'input_transcript' && entry.finished)) {
          clearTimeout(timer);
          socket.close();
          resolve();
        }
      });
      socket.on('error', reject);
    });
    expect(events.find(event => event.type === 'ready')).toMatchObject({ mode: 'mock', theme: 'The 90s' });
    expect(events.find(event => event.type === 'output_transcript')).toMatchObject({ text: 'Hello players' });
    const assembled = events.filter(event => event.type === 'input_transcript').map(event => String(event.text)).join('').replace(/\s+/g, ' ').trim();
    expect(assembled).toBe('two players');
    expect(events.some(event => event.type === 'input_transcript' && event.finished === true)).toBe(true);
  });
});
