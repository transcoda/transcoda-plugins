import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { arrFixture } from '../test/fixtures.ts';
import { arrClient } from './client.ts';
import {
  type HistoryEvent,
  importedGrab,
  itemHistory,
  latestImport,
  REQUEST_WINDOW_MS,
  recentBlocklisted,
  recentMarkedFailed,
} from './history.ts';

const BASE = 'http://radarr:7878';
const settings = { url: BASE, apiKey: 'SENTINEL-SECRET-9f3a' };
const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 86_400_000;

const movieEvents = async () => {
  const ctx = fakePluginContext({
    settings,
    responses: [
      {
        match: { url: `${BASE}/api/v3/history/movie?movieId=11` },
        body: arrFixture('history-movie'),
      },
    ],
  });
  return itemHistory(arrClient(ctx, 'Radarr'), '/api/v3/history/movie?movieId=11');
};
const seriesEvents = () =>
  (arrFixture('history-series') as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as number,
    eventType: e.eventType as string,
    date: e.date as string,
    sourceTitle: e.sourceTitle as string,
    episodeId: e.episodeId as number,
    downloadId: e.downloadId as string,
  }));
const ev = (
  id: number,
  eventType: string,
  date: string,
  downloadId: string,
  episodeId?: number,
): HistoryEvent => ({
  id,
  eventType,
  date,
  sourceTitle: `release-${downloadId}`,
  downloadId,
  ...(episodeId === undefined ? {} : { episodeId }),
});

describe('itemHistory', () => {
  it('reads the events and drops malformed ones', async () => {
    const events = await movieEvents();
    expect(events.map((e) => e.id)).toEqual([30, 31, 42, 43]);
    expect(events[3]?.downloadId).toBe('0000000000000000000000000000000000000042');
    const ctx = fakePluginContext({
      settings,
      responses: [
        {
          match: { url: /history/ },
          body: [{ id: 1 }, null, { id: 2, eventType: 'grabbed', date: 'x', sourceTitle: 's' }],
        },
      ],
    });
    expect(await itemHistory(arrClient(ctx, 'Radarr'), '/api/v3/history/movie?movieId=1')).toEqual(
      [],
    );
  });
});

describe('recentMarkedFailed', () => {
  it('finds a downloadFailed event within 7 days and ignores older ones and other episodes', async () => {
    const movie = await movieEvents();
    // The fixture's only failure is 2026-09-01: outside the window.
    expect(recentMarkedFailed(movie, { now: NOW, windowMs: REQUEST_WINDOW_MS })).toBeNull();
    const beforeImport = movie.filter((e) => e.date < '2026-09-05');
    expect(
      recentMarkedFailed(beforeImport, {
        now: Date.parse('2026-09-05T00:00:00Z'),
        windowMs: 7 * DAY,
      }),
    ).toEqual({ date: '2026-09-01T10:00:00Z' });
    const series = seriesEvents();
    // Episode 102 failed on 2026-10-25; episodes 100 and 101 never did.
    expect(
      recentMarkedFailed(series, { episodeIds: [100, 101], now: NOW, windowMs: 7 * DAY }),
    ).toBeNull();
    expect(
      recentMarkedFailed(series, { episodeIds: [101, 102], now: NOW, windowMs: 7 * DAY }),
    ).toEqual({ date: '2026-10-25T10:00:00Z' });
  });

  it('ignores a downloadFailed older than the latest import: the file came after it', () => {
    const events = [
      ev(1, 'grabbed', '2026-10-21T08:00:00Z', 'a'),
      ev(2, 'downloadFailed', '2026-10-22T08:00:00Z', 'a'),
      ev(3, 'grabbed', '2026-10-24T08:00:00Z', 'b'),
      ev(4, 'downloadFolderImported', '2026-10-24T09:00:00Z', 'b'),
    ];
    expect(recentMarkedFailed(events, { now: NOW, windowMs: 7 * DAY })).toBeNull();
    // A failure after the import still counts.
    const later = [...events, ev(5, 'downloadFailed', '2026-10-25T08:00:00Z', 'b')];
    expect(recentMarkedFailed(later, { now: NOW, windowMs: 7 * DAY })).toEqual({
      date: '2026-10-25T08:00:00Z',
    });
    // Sonarr: only imports of the file's episodes move the cutoff.
    const series = [
      ev(1, 'downloadFailed', '2026-10-22T08:00:00Z', 'a', 100),
      ev(2, 'downloadFolderImported', '2026-10-24T09:00:00Z', 'c', 105),
    ];
    expect(recentMarkedFailed(series, { episodeIds: [100], now: NOW, windowMs: 7 * DAY })).toEqual({
      date: '2026-10-22T08:00:00Z',
    });
  });
});

describe('latestImport', () => {
  it('returns the newest downloadFolderImported event of the item (of the episodes, when given)', async () => {
    expect(latestImport(await movieEvents())?.id).toBe(43);
    expect(latestImport(seriesEvents(), { episodeIds: [100, 101] })?.id).toBe(62);
    expect(latestImport(seriesEvents(), { episodeIds: [102] })).toBeNull();
  });
});

describe('importedGrab', () => {
  it('returns the grab whose downloadId produced the newest import', async () => {
    expect(importedGrab(await movieEvents())).toEqual({
      id: 42,
      sourceTitle: 'Example.Movie.2019.1080p.WEB-DL-GRP',
    });
    expect(importedGrab(seriesEvents(), { episodeIds: [100, 101] })).toEqual({
      id: 60,
      sourceTitle: 'Example.Show.S01E03E04.1080p.WEB-DL-GRP',
    });
    expect(importedGrab(seriesEvents(), { episodeIds: [999] })).toBeNull();
    expect(importedGrab([])).toBeNull();
  });

  it('does not pick an upgrade grab newer than the import', () => {
    const events = [
      ev(1, 'grabbed', '2026-10-20T08:00:00Z', 'a'),
      ev(2, 'downloadFolderImported', '2026-10-20T09:00:00Z', 'a'),
      ev(3, 'grabbed', '2026-10-26T08:00:00Z', 'b'),
    ];
    expect(importedGrab(events)).toEqual({ id: 1, sourceTitle: 'release-a' });
  });

  it('does not pick a single-episode grab of one episode of a multi-episode file', () => {
    const events = [
      ev(1, 'grabbed', '2026-10-20T08:00:00Z', 'pack', 100),
      ev(2, 'grabbed', '2026-10-20T08:00:00Z', 'pack', 101),
      ev(3, 'downloadFolderImported', '2026-10-20T09:00:00Z', 'pack', 100),
      ev(4, 'downloadFolderImported', '2026-10-20T09:00:00Z', 'pack', 101),
      ev(5, 'grabbed', '2026-10-25T08:00:00Z', 'single', 101),
    ];
    expect(importedGrab(events, { episodeIds: [100, 101] })?.sourceTitle).toBe('release-pack');
  });

  it('is null when the newest import has no matching grab or no downloadId', () => {
    const events = [
      ev(1, 'grabbed', '2026-10-20T08:00:00Z', 'a'),
      ev(2, 'downloadFolderImported', '2026-10-21T09:00:00Z', 'b'),
    ];
    expect(importedGrab(events)).toBeNull();
    const { downloadId: _, ...noId } = ev(3, 'downloadFolderImported', '2026-10-22T09:00:00Z', 'a');
    expect(importedGrab([...events, noId])).toBeNull();
  });
});

describe('recentBlocklisted', () => {
  it('reads one page newest first and matches the movie by date', async () => {
    const path =
      '/api/v3/blocklist?page=1&pageSize=100&sortKey=date&sortDirection=descending&movieIds=11';
    const ctx = fakePluginContext({
      settings,
      responses: [
        { match: { url: BASE + path }, body: arrFixture('blocklist-movie') },
        { match: { url: BASE + path }, body: arrFixture('blocklist-movie') },
      ],
    });
    const client = arrClient(ctx, 'Radarr');
    expect(
      await recentBlocklisted(client, { movieId: 11 }, { now: NOW, windowMs: 7 * DAY }),
    ).toBeNull();
    expect(
      await recentBlocklisted(
        client,
        { movieId: 11 },
        { now: Date.parse('2026-09-02T00:00:00Z'), windowMs: 7 * DAY },
      ),
    ).toEqual({ date: '2026-09-01T10:00:00Z' });
  });

  it('ignores entries at or before `after` (the latest import)', async () => {
    const path =
      '/api/v3/blocklist?page=1&pageSize=100&sortKey=date&sortDirection=descending&movieIds=11';
    const ctx = fakePluginContext({
      settings,
      responses: [{ match: { url: BASE + path }, body: arrFixture('blocklist-movie') }],
    });
    expect(
      await recentBlocklisted(
        arrClient(ctx, 'Radarr'),
        { movieId: 11 },
        {
          now: Date.parse('2026-09-02T00:00:00Z'),
          windowMs: 7 * DAY,
          after: Date.parse('2026-09-01T12:00:00Z'),
        },
      ),
    ).toBeNull();
  });

  it('matches a series entry only when it holds one of the episodes, and ignores other items', async () => {
    const path =
      '/api/v3/blocklist?page=1&pageSize=100&sortKey=date&sortDirection=descending&seriesIds=1';
    const page = arrFixture('blocklist-series') as { records: unknown[] };
    const otherSeries = { ...(page.records[0] as object), seriesId: 2, episodeIds: [100] };
    const ctx = fakePluginContext({
      settings: { ...settings, url: 'http://nas:8989' },
      responses: [
        { match: { url: `http://nas:8989${path}` }, body: page as never },
        {
          match: { url: `http://nas:8989${path}` },
          body: { ...page, records: [...page.records, otherSeries] } as never,
        },
      ],
    });
    const client = arrClient(ctx, 'Sonarr');
    const opts = { now: NOW, windowMs: 7 * DAY };
    expect(await recentBlocklisted(client, { seriesId: 1, episodeIds: [101, 102] }, opts)).toEqual({
      date: '2026-10-25T10:00:00Z',
    });
    expect(await recentBlocklisted(client, { seriesId: 1, episodeIds: [100] }, opts)).toBeNull();
  });
});
