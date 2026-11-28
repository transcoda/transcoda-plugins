import { fakePluginContext, runTrigger } from '@transcoda/sdk/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from './json.ts';
import { webhookFixture } from './test-util.ts';
import { importTrigger } from './trigger.ts';

const sonarr = importTrigger('sonarr');
const radarr = importTrigger('radarr');

function call(
  trigger: typeof sonarr,
  body: JsonValue,
  mappings: Array<{ remote: string; local: string }> = [],
) {
  const ctx = fakePluginContext({ settings: {}, mappings });
  return runTrigger(trigger, ctx, { method: 'POST', headers: {}, body }, {});
}

const withFile = (name: string, key: string, file: Record<string, JsonValue>) => {
  const body = webhookFixture(name) as Record<string, JsonValue>;
  return { ...body, [key]: { ...(body[key] as Record<string, JsonValue>), ...file } };
};

describe('importTrigger', () => {
  it('is an import trigger that takes Basic auth and no settings', () => {
    expect(sonarr).toMatchObject({ id: 'import', auth: { basic: true } });
    expect(sonarr.settings.parse({})).toEqual({});
    expect(radarr.title).toBe('Import from Radarr');
  });

  it('queues the file Sonarr imported, with a note naming the episode', async () => {
    expect(await call(sonarr, webhookFixture('sonarr-download'))).toEqual({
      kind: 'files',
      files: [
        {
          path: '/data/shows/Example Show 2/Season 01/S01E01.mkv',
          note: 'Sonarr imported Example Show 2 S01E01',
          dedupKey: 'sonarr:301',
        },
      ],
    });
  });

  it('queues an upgrade the same way', async () => {
    const r = await call(sonarr, webhookFixture('sonarr-upgrade'));
    expect(r).toMatchObject({
      kind: 'files',
      files: [{ note: 'Sonarr upgraded Example Show 2 S01E01' }],
    });
  });

  it('queues the movie file Radarr imported', async () => {
    expect(await call(radarr, webhookFixture('radarr-download'))).toEqual({
      kind: 'files',
      files: [
        {
          path: '/data/movies/Example Movie (2019)/Example Movie (2019).mkv',
          note: 'Radarr imported Example Movie (2019)',
          dedupKey: 'radarr:501',
        },
      ],
    });
  });

  it("maps Sonarr's path to Transcoda's with the path mappings", async () => {
    const r = await call(sonarr, webhookFixture('sonarr-download'), [
      { remote: '/data/shows', local: '/media/tv' },
    ]);
    expect(r).toMatchObject({
      files: [{ path: '/media/tv/Example Show 2/Season 01/S01E01.mkv' }],
    });
  });

  it('builds the path from the folder and the relative path when the file has no path', async () => {
    const body = withFile('radarr-download', 'movieFile', { path: null });
    expect(await call(radarr, body)).toMatchObject({
      files: [{ path: '/data/movies/Example Movie (2019)/Example Movie (2019).mkv' }],
    });
  });

  it('answers the test button', async () => {
    expect(await call(sonarr, webhookFixture('sonarr-test'))).toEqual({
      kind: 'test',
      message: 'Sonarr reached Transcoda; imports and upgrades will be queued',
    });
    expect(await call(radarr, webhookFixture('radarr-test'))).toMatchObject({ kind: 'test' });
  });

  it('ignores every other event', async () => {
    expect(await call(sonarr, webhookFixture('sonarr-rename'))).toEqual({
      kind: 'ignore',
      reason: 'Sonarr event Rename does not import a file',
    });
    expect(await call(sonarr, webhookFixture('sonarr-import-complete'))).toMatchObject({
      kind: 'ignore',
    });
  });

  it('ignores bodies that are not a Sonarr or Radarr import', async () => {
    for (const body of [null, 'Download', [], {}, { eventType: 7 }]) {
      expect(await call(sonarr, body as JsonValue)).toMatchObject({ kind: 'ignore' });
    }
    // Radarr's body sent to the Sonarr trigger has no episode file.
    expect(await call(sonarr, webhookFixture('radarr-download'))).toEqual({
      kind: 'ignore',
      reason: 'Sonarr sent an import without a file path',
    });
  });

  it('never queues a path that is relative, has .. segments or is not a string', async () => {
    for (const path of ['Season 01/S01E01.mkv', '/data/shows/../../etc/passwd', 42, '']) {
      const body = withFile('sonarr-download', 'episodeFile', {
        path,
        relativePath: '../../../etc/passwd',
      });
      expect(await call(sonarr, body)).toEqual({
        kind: 'ignore',
        reason: 'Sonarr sent an import without a file path',
      });
    }
  });

  it('keeps the note short', async () => {
    const body = webhookFixture('radarr-download') as Record<string, JsonValue>;
    const long = { ...body, movie: { title: 'x'.repeat(5000), year: 2019 } };
    const r = await call(radarr, long);
    expect(r.kind === 'files' && (r.files[0]?.note.length ?? 0)).toBeLessThanOrEqual(200);
  });
});

describe('importTrigger, for any body', () => {
  const segment = fc.constantFrom('data', 'shows', '..', '.', '', 'S01E01.mkv', 'a b');
  const path = fc.array(segment, { maxLength: 6 }).map((s) => s.join('/'));
  const maybeAbsolute = fc.oneof(
    path,
    path.map((p) => `/${p}`),
    fc.anything(),
  );
  const body = fc.record({
    eventType: fc.oneof(fc.constantFrom('Download', 'Test', 'Grab'), fc.anything()),
    isUpgrade: fc.anything(),
    series: fc.oneof(fc.record({ path: maybeAbsolute, title: fc.anything() }), fc.anything()),
    movie: fc.oneof(fc.record({ folderPath: maybeAbsolute, title: fc.anything() }), fc.anything()),
    episodeFile: fc.oneof(
      fc.record({ path: maybeAbsolute, relativePath: maybeAbsolute, id: fc.anything() }),
      fc.anything(),
    ),
    movieFile: fc.oneof(
      fc.record({ path: maybeAbsolute, relativePath: maybeAbsolute, id: fc.anything() }),
      fc.anything(),
    ),
    episodes: fc.anything(),
  });

  it('never throws, and only ever names an absolute path without .. segments', async () => {
    await fc.assert(
      fc.asyncProperty(body, fc.constantFrom(sonarr, radarr), async (b, trigger) => {
        const r = await call(trigger, b as JsonValue);
        if (r.kind !== 'files') return;
        for (const f of r.files) {
          expect(f.path.startsWith('/')).toBe(true);
          expect(f.path.split('/')).not.toContain('..');
        }
      }),
    );
  });
});
