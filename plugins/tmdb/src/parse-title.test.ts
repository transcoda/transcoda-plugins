import { describe, expect, it } from 'vitest';
import { parseTitle } from './parse-title.ts';

type Row = [file: string, folder: string, title: string, year: number | null, kind: string];
const rows: Row[] = [
  ['Heat.1995.1080p.BluRay.x264-GROUP.mkv', '/data/movies/Heat (1995)', 'Heat', 1995, 'movie'],
  [
    'Tigger & Pooh - S01E03 - Title.mkv',
    '/data/shows/Tigger & Pooh/Season 01',
    'Tigger & Pooh',
    null,
    'tv',
  ],
  [
    'Show.Name.S02E10.720p.WEB.H264-ABC.mkv',
    '/data/shows/Show Name/Season 02',
    'Show Name',
    null,
    'tv',
  ],
  ['Movie (2019).mp4', '/data/movies', 'Movie', 2019, 'movie'],
  ['S01E03.mkv', '/data/shows/Show Name (2019)/Season 01', 'Show Name', 2019, 'tv'],
  ['Just A Name.mkv', '/data/movies', 'Just A Name', null, 'unknown'],
  ['Heat.1080p.1995.BluRay.mkv', '', 'Heat', 1995, 'movie'],
  ['The.Show.2019.S01E02.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv', '', 'The Show', 2019, 'tv'],
  ['Show 1x05 Title.avi', '', 'Show', null, 'tv'],
  ['show_name_s03e12_hdtv.mkv', '', 'show name', null, 'tv'],
  ['Blade Runner 2049 (2017) 2160p HDR REMUX.mkv', '', 'Blade Runner 2049', 2017, 'movie'],
  ['Spider-Man.2002.720p.BRRip.x265.HEVC-GRP.mkv', '', 'Spider-Man', 2002, 'movie'],
  ['Amelie.2001.mkv', '', 'Amelie', 2001, 'movie'],
  ['1917.mkv', '', '1917', null, 'unknown'],
  ['Name.Only.1080p.WEB-DL.mkv', '', 'Name Only', null, 'unknown'],
  ['Movie_Name_(2020)_PROPER.mkv', '', 'Movie Name', 2020, 'movie'],
  ['S02E01.mkv', '/data/shows/Other Show/Specials', 'Other Show', null, 'tv'],
  ['Mr. Robot S01E01.mkv', '', 'Mr Robot', null, 'tv'],
  ['Heat (1995)-GRP.mkv', '', 'Heat', 1995, 'movie'],
  ['Dark.Web.2019.mkv', '', 'Dark Web', 2019, 'movie'],
  ['The Web (2004).mkv', '', 'The Web', 2004, 'movie'],
  ['video.mkv', '/data/movies/Drift (2019)', 'Drift', 2019, 'movie'],
  // Jan's library (names from the copy run).
  [
    'A.Case.of.Bread.and.Butter.2008.DEU.BluRay.Remux.1080p.AVC.DTS-HD.MA.5.1-GRP-Obfuscated.mkv',
    '',
    'A Case of Bread and Butter',
    2008,
    'movie',
  ],
  ['Drift.2019.1080p.DSNP.WEB-DL.DDP5.1.H.264.DUAL-GRP.mkv', '', 'Drift', 2019, 'movie'],
  [
    'Chilly.the.Penguin.1969.2160p.BDRip.AAC.5.1.HDR10.x265.10bit-GRP.mkv',
    '',
    'Chilly the Penguin',
    1969,
    'movie',
  ],
  [
    'banana.the.band.the.show.the.movie.2025.720p.webrip.x264.aac-grp.xyz.mp4',
    '',
    'banana the band the show the movie',
    2025,
    'movie',
  ],
  ['Pebble.2016.1080p.Blu-ray.DTSHD-MA.7.1.HEVC-GRP.mkv', '', 'Pebble', 2016, 'movie'],
  ['Raiders.S01E03.On.the.Edge.EAC3.5.1.1080p.WEBRip.x265-GRP.mkv', '', 'Raiders', null, 'tv'],
  [
    'For.All.Robots.S05E07.The.Moons.of.Mars.720p.HEVC.x265-GRP.mkv',
    '',
    'For All Robots',
    null,
    'tv',
  ],
  ['Takeover.S02E04.Switch.720p.ATVP.WEB-DL.DD5.1.Atmos.H.264-GRP.mkv', '', 'Takeover', null, 'tv'],
  ['CHEF.S01E03.1080p.NF.WEB-DL.DDP5.1.H.264-GRP.mp4', '', 'CHEF', null, 'tv'],
  [
    'Meister Holz und sein Kobold S01E10 German 720p BluRay x264-GRP.mp4',
    '',
    'Meister Holz und sein Kobold',
    null,
    'tv',
  ],
  [
    'Die.Nachbarn.S01E04.Teil.4.720p.ARD.WEB-DL.AAC2.0.H.264-GRP.mkv',
    '',
    'Die Nachbarn',
    null,
    'tv',
  ],
  [
    'The.Last.of.Them.S02E02.Through.the.Forest.HMAX.WEB-DL.1080p.H.265.DD5.1.E.AC3.MULTI.GRP.mkv',
    '',
    'The Last of Them',
    null,
    'tv',
  ],
];

describe('parseTitle', () => {
  it.each(rows)('%s in %s', (file, folder, title, year, kind) => {
    expect(parseTitle(file, folder)).toEqual({ title, year, kind });
  });

  it('keeps a title that starts with a release word in the very first position', () => {
    expect(parseTitle('Atmos.2019.mkv', '').title).toBe('Atmos');
  });
});
