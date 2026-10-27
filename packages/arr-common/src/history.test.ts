import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { arrFixture } from '../test/fixtures.ts';
import { arrClient } from './client.ts';
import {
  itemHistory,
  latestGrab,
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
  }));

describe('itemHistory', () => {
  it('reads the events and drops malformed ones', async () => {
    const events = await movieEvents();
    expect(events.map((e) => e.id)).toEqual([30, 31, 42, 43]);
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
    expect(
      recentMarkedFailed(movie, { now: Date.parse('2026-09-05T00:00:00Z'), windowMs: 7 * DAY }),
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
});

describe('latestGrab', () => {
  it('returns the newest grabbed event id and sourceTitle, null without one', async () => {
    expect(latestGrab(await movieEvents())).toEqual({
      id: 42,
      sourceTitle: 'Example.Movie.2019.1080p.WEB-DL-GRP',
    });
    expect(latestGrab(seriesEvents(), { episodeIds: [101] })).toEqual({
      id: 61,
      sourceTitle: 'Example.Show.S01E03E04.1080p.WEB-DL-GRP',
    });
    expect(latestGrab(seriesEvents(), { episodeIds: [999] })).toBeNull();
    expect(latestGrab([])).toBeNull();
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
