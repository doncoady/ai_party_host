/**
 * Builds theme packs and caches their clips ahead of play, e.g. right after
 * `npm install` or on a schedule:
 *
 *   npx tsx scripts/prebuild-packs.ts                 # PREBUILD_THEMES (default: The 80s, The 90s)
 *   npx tsx scripts/prebuild-packs.ts "Disney" "Hip Hop"
 *
 * Uses the same catalog + clip pipeline as the server, so packs built here are
 * instantly available when the game starts.
 */
import { config } from '../server/config.ts';
import { localLibrary } from '../server/local.ts';
import { packService } from '../server/packs.ts';
import { clipPipeline } from '../server/clips/pipeline.ts';

async function main() {
  await localLibrary.init();
  // Featured themes, plus every genre/folder the local music collection can serve.
  const themes = Array.from(new Set(process.argv.slice(2).length ? process.argv.slice(2) : [...config.prebuildThemes, ...localLibrary.impliedThemes()]));
  const local = localLibrary.status();
  if (local.songs) console.log(`Local library: ${local.songs} songs in ${local.settings.localSongsDir} (themes: ${local.themes.join(', ') || 'none'})`);
  console.log(`Prebuilding ${themes.length} theme pack(s): ${themes.join(', ')}`);
  for (const theme of themes) {
    const startedAt = Date.now();
    const result = await packService.resolve({ theme, difficulty: 'medium', clipSeconds: 3 });
    if (!result) {
      console.warn(`  ✗ ${theme}: no sources`);
      continue;
    }
    const clips = result.pack.questions.map(question => question.clip).filter((clip): clip is NonNullable<typeof clip> => Boolean(clip));
    let ready = 0;
    for (const clip of clips) {
      const record = await clipPipeline.waitFor(clip.id, 120_000);
      if (record?.status === 'ready') ready += 1;
    }
    console.log(`  ✓ ${theme}: ${result.pack.questions.length} questions, ${ready}/${clips.length} clips cached (${result.origin}, ${Math.round((Date.now() - startedAt) / 1000)} s)`);
  }
}

main().then(() => process.exit(0), error => {
  console.error(error);
  process.exit(1);
});
