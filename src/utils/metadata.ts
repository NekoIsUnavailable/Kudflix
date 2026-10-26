import { resolveEpisodeNumbers } from './episodeParsing';

export interface MovieMeta {
  title: string;
  poster: string | null;
  description: string;
  year: string;
  genre: string;
}

/** Known release / codec / group tokens, stripped when they appear after the title. */
const RELEASE_TAGS =
  /\b(?:2160p|1080p|720p|480p|4320p|4k|8k|uhd|fhd|hd|sd|hq|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|web-?rip|hdrip|dvdrip|hdtv|tvrip|cam|x264|x265|hevc|h264|h265|h\.?\s*265|h\.?\s*264|avc|10bit|8bit|12bit|aac|aac\d+(?:\.\d+)?|ddp\d*(?:\.\d+)?|ddp|dd\+?|dts|truehd|atmos|ma|5\.1|7\.1|2\.0|remux|proper|repack|extended|unrated|hdr10\+?|hdr|dovi|dv|sdr|nf|amzn|atvp|yts|yify|rarbg|hmax|dsnp|pcok|max|internal|limited|custom|subbed|dubbed|english|joy|flux|afm72|gige|h4xo|ntb)\b/gi;

const EDITION_TAGS =
  /\b(?:uncut|theatrical\s*cut|extended\s*(?:cut|edition)|directors?\s*cut|final\s*cut|unrated\s*cut|special\s*edition|ultimate\s*edition|collectors?\s*edition|anniversary\s*edition|remastered|criterion\s*collection)\b/gi;

/** Trailing release-group suffixes, e.g. -SM737, -YTS.MX, [YTS.MX], not title words (case-sensitive on -groups). */
const GROUP_SUFFIX =
  /(?:[-_][A-Z0-9]{2,12}(?:\.[A-Z0-9]{2,8})*$|\[[A-Za-z0-9][A-Za-z0-9.\-_]*\]$)/;

const EPISODE_CODE = /[.\s_-]*[Ss](\d{1,2})[Ee](\d{1,2})/i;

function isTitleEmbeddedYear(name: string, year: string): boolean {
  const trimmed = name.trim();
  if (!trimmed.startsWith(year)) return false;
  const rest = trimmed.slice(year.length);
  return /^(\s*[:–—-]|\s+[A-Za-z])/.test(rest);
}

function extractYearFromName(name: string): string {
  const patterns: RegExp[] = [
    /\(\s*((?:19|20)\d{2})\s*\)/g,
    /\[\s*((?:19|20)\d{2})\s*\]/g,
    /(?:^|[.\s_-])((?:19|20)\d{2})(?=[.\s_.\-[\]|]|$)/g,
  ];

  const candidates: string[] = [];
  for (const pattern of patterns) {
    for (const match of name.matchAll(pattern)) {
      const year = match[1];
      if (year && !isTitleEmbeddedYear(name, year)) candidates.push(year);
    }
  }

  if (candidates.length === 0) return '';
  // Release year usually follows the title (e.g. Blade.Runner.2049.2017…).
  return candidates[candidates.length - 1];
}

/** Parse TV series folder names like "Rome (2005)". */
export function parseSeriesFolderName(folderName: string): { title: string; year: string } {
  const trimmed = folderName.trim();
  const parenMatch = trimmed.match(/^(.+?)\s*\(\s*((?:19|20)\d{2})\s*\)\s*$/);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), year: parenMatch[2] };
  }
  const parsed = parseFilenameMeta(`${trimmed}.folder`);
  return {
    title: parsed.title || trimmed,
    year: parsed.year,
  };
}

function stripFromReleaseYear(name: string, year: string): string {
  if (!year || isTitleEmbeddedYear(name, year)) return name;

  const normalized = name.replace(/[._-]+/g, ' ').trim();
  if (normalized === year) return name;

  const patterns = [
    new RegExp(`\\(\\s*${year}\\s*\\)[\\s\\S]*$`, 'i'),
    new RegExp(`\\[\\s*${year}\\s*\\][\\s\\S]*$`, 'i'),
    new RegExp(`[.\\s_-]${year}(?:[.\\s_-][\\s\\S]*)?$`, 'i'),
  ];

  for (const pattern of patterns) {
    if (pattern.test(name)) {
      return name.replace(pattern, '');
    }
  }

  return name.replace(new RegExp(`[.\\s_-]${year}$`, 'i'), '');
}

function stripReleaseClutter(name: string, year: string): string {
  let result = stripFromReleaseYear(name, year);

  // Strip dotted audio tokens before spaces split "DDP5.1" → "DDP5 1".
  result = result.replace(/\bddp\d*(?:\.\d+)?\b/gi, ' ');

  // Dot-separated titles (Spider-Man.Brand.New.Day) must become words before tag/group stripping.
  result = result.replace(/[._-]+/g, ' ');

  result = result
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(GROUP_SUFFIX, ' ')
    .replace(RELEASE_TAGS, ' ')
    .replace(/\bweb\s*-?\s*dl\b/gi, ' ')
    .replace(/\bddp\s*\d+(?:\s*\d+)?\b/gi, ' ')
    // Season-pack folders (Cyberpunk.Edgerunners.S02.2160p…) — not S02E03 episode codes.
    .replace(/\bS(?:(?:eason)?\s*)?\d{1,2}\b(?!\s*E\s*\d)/gi, ' ')
    .replace(EDITION_TAGS, ' ');

  if (year) {
    result = result.replace(new RegExp(`\\b${year}\\b`, 'g'), ' ');
  }

  result = result.replace(/\b\d\s+\d\b/g, ' ');

  return result
    .replace(/[\[(]+$/g, '')
    .replace(/[\])]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripEpisodePart(raw: string): string {
  let s = raw;
  s = s.replace(/\bddp\d*(?:\.\d+)?\b/gi, ' ');
  s = s.replace(/\([^)]*(?:1080p|2160p|720p|480p|bluray|webrip|web-?dl|x265|x264|h265|h\.?\s*265)[^)]*\)/gi, ' ');
  s = s.replace(/\[[^\]]*\]/g, ' ');
  s = s.replace(GROUP_SUFFIX, ' ');
  s = s.replace(RELEASE_TAGS, ' ');
  s = s.replace(/\bweb\s*-?\s*dl\b/gi, ' ');
  s = s.replace(EDITION_TAGS, ' ');
  s = s.replace(/[._-]+/g, ' ');
  s = s.replace(/\b\d\s+\d\b/g, ' ');
  return s.replace(/\s{2,}/g, ' ').trim();
}

function isEpisodeFilename(name: string): boolean {
  return EPISODE_CODE.test(name) || /\d{1,2}x\d{1,2}/i.test(name);
}

/** Parse TV episode filenames into a display title + optional season/episode. */
export function parseEpisodeFilename(filename: string): {
  episodeTitle: string;
  season?: number;
  episode?: number;
  year?: string;
} {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');

  const dashMatch = withoutExt.match(/^(.+?)\s*-\s*[Ss](\d{1,2})[Ee](\d{1,2})\s*-\s*(.+)$/i);
  if (dashMatch) {
    const season = parseInt(dashMatch[2], 10);
    const episode = parseInt(dashMatch[3], 10);
    const seriesPart = dashMatch[1].trim();
    const year = extractYearFromName(seriesPart);
    const episodeTitle = stripEpisodePart(dashMatch[4]);
    return {
      episodeTitle: episodeTitle || `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
      season,
      episode,
      year: year || undefined,
    };
  }

  const seMatch = withoutExt.match(EPISODE_CODE);
  if (!seMatch || seMatch.index === undefined) {
    const movie = parseFilenameMeta(filename);
    return { episodeTitle: movie.title, year: movie.year || undefined };
  }

  const season = parseInt(seMatch[1], 10);
  const episode = parseInt(seMatch[2], 10);
  const after = withoutExt.slice(seMatch.index + seMatch[0].length);
  let episodeTitle = stripEpisodePart(after.replace(/^[.\s_-]+/, ''));

  if (!episodeTitle) {
    const before = withoutExt.slice(0, seMatch.index).trim();
    const year = extractYearFromName(before);
    const beforeClean = stripReleaseClutter(before.replace(/[._-]+/g, ' '), year);
    const showPart = beforeClean.replace(/\s*S\d{1,2}E\d{1,2}\s*.*$/i, '').trim();
    const tailMatch = showPart.match(/(?:^.*\s)?([A-Za-z][A-Za-z\s'-]{1,40})$/);
    episodeTitle = tailMatch?.[1]?.trim() || '';
  }

  return {
    episodeTitle: episodeTitle || `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
    season,
    episode,
  };
}

export function parseFilenameMeta(filename: string): { title: string; year: string } {
  if (isEpisodeFilename(filename)) {
    const ep = parseEpisodeFilename(filename);
    return { title: ep.episodeTitle, year: ep.year ?? '' };
  }

  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  const year = extractYearFromName(withoutExt);
  const title = stripReleaseClutter(withoutExt, year);

  return { title: title || withoutExt.replace(/[._-]+/g, ' ').trim(), year };
}

export function cleanTitle(filename: string): string {
  return parseFilenameMeta(filename).title;
}

export function getEpisodeDisplayTitle(
  ep: { name: string; meta?: { title?: string }; relativePath?: string },
  tmdbEpisodeName?: string | null,
): string {
  const resolved = resolveEpisodeNumbers(ep.name, ep.relativePath);
  const parsed =
    parseEpisodeFilename(ep.name).season !== undefined
      ? parseEpisodeFilename(ep.name)
      : null;

  const localTitle = ep.meta?.title || ep.name;
  const label = tmdbEpisodeName || (parsed?.episodeTitle ?? localTitle);

  const season = resolved?.season ?? parsed?.season;
  const episode = resolved?.episode ?? parsed?.episode;

  if (season != null && episode != null) {
    const code = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    if (label.toLowerCase().startsWith('s') && /s\d+e\d/i.test(label)) return label;
    if (label === code) return code;
    return `${code} · ${label}`;
  }

  return label;
}

/** Instant local metadata, no network. Used during library scan. */
export function getLocalMeta(
  filename: string,
  category?: 'movie' | 'tv' | 'anime',
  filePath?: string,
): MovieMeta {
  const parseSource = filePath ? basenameFromPath(filePath) : filename;
  const isSeriesOrAnime = (category === 'tv' || category === 'anime') && isEpisodeFilename(parseSource);
  const { title, year } =
    isSeriesOrAnime
      ? (() => {
          const ep = parseEpisodeFilename(parseSource);
          return { title: ep.episodeTitle, year: ep.year ?? '' };
        })()
      : parseFilenameMeta(parseSource);

  return {
    title,
    poster: null,
    description: 'A video file from your local library.',
    year,
    genre: category === 'anime' ? 'Anime' : category === 'tv' ? 'Series' : 'Local Media',
  };
}

export function basenameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function normalizeComparableTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** When NFO and filename disagree, keep the more specific title (e.g. Blade Runner 2049 vs Blade Runner). */
export function pickPreferredTitle(fromNfo: string, fromFile: string): string {
  const nfo = fromNfo.trim();
  const file = fromFile.trim();
  if (!file) return nfo;
  if (!nfo) return file;

  const n = normalizeComparableTitle(nfo);
  const f = normalizeComparableTitle(file);
  if (n === f) return nfo;
  if (f.includes(n) && f.length > n.length) return file;
  if (n.includes(f) && n.length > f.length) return nfo;
  return nfo;
}

function parseNfoMeta(
  nfo: string,
  fallbackTitle: string,
  category?: 'movie' | 'tv' | 'anime',
  filePath?: string,
): MovieMeta {
  const parseSource = filePath ? basenameFromPath(filePath) : fallbackTitle;
  const fromFile = parseFilenameMeta(parseSource);
  const meta = getLocalMeta(fallbackTitle, category, filePath);

  const titleMatch = nfo.match(/<title>(.*?)<\/title>/i);
  const plotMatch = nfo.match(/<plot>(.*?)<\/plot>/i);
  const yearMatch = nfo.match(/<year>(.*?)<\/year>/i);
  const genreMatch = nfo.match(/<genre>(.*?)<\/genre>/i);

  if (titleMatch) {
    meta.title = pickPreferredTitle(titleMatch[1], fromFile.title);
  } else if (fromFile.title) {
    meta.title = fromFile.title;
  }

  if (plotMatch) meta.description = plotMatch[1];
  if (yearMatch) meta.year = yearMatch[1];
  else if (fromFile.year) meta.year = fromFile.year;
  if (genreMatch) meta.genre = genreMatch[1];

  return meta;
}

export function resolveFileMeta(
  file: { name: string; path?: string; localNfoContent?: string | null },
  category?: 'movie' | 'tv' | 'anime',
): MovieMeta {
  if (file.localNfoContent) {
    return parseNfoMeta(file.localNfoContent, file.name, category, file.path);
  }
  return getLocalMeta(file.name, category, file.path);
}

export async function fetchMetadata(filename: string): Promise<MovieMeta> {
  const { title, year } = parseFilenameMeta(filename);

  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=movie&limit=1`);
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      const movie = data.results[0];
      return {
        title: movie.trackName || title,
        poster: movie.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
        description: movie.longDescription || movie.shortDescription || 'No description available.',
        year: movie.releaseDate ? movie.releaseDate.substring(0, 4) : year || 'Unknown',
        genre: movie.primaryGenreName || 'Movie',
      };
    }
  } catch (error) {
    console.error('Failed to fetch metadata for', title, error);
  }

  return {
    title,
    poster: null,
    description: 'A video file from your local library.',
    year,
    genre: 'Local Media',
  };
}
