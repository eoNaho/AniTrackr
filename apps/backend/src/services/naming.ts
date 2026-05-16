import { join } from "path";

/**
 * Nomenclatura Jellyfin/Plex-compatible para organização de arquivos.
 *
 * Estrutura de séries:
 *   <base>/<Título (Ano)>/Season <NN>/<Título> S<NN>E<NN>.mkv
 *
 * Estrutura de filmes:
 *   <base>/Movies/<Título (Ano)>/<Título (Ano)>.mkv
 */

/** Remove caracteres inválidos em nomes de arquivo/pasta */
export function sanitize(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function normalizeAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseSafePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) return null;
  return parsed;
}

function parseRomanNumeral(value: string): number | null {
  const roman = value.trim().toUpperCase();
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  let prev = 0;
  for (let i = roman.length - 1; i >= 0; i -= 1) {
    const current = map[roman[i]];
    if (!current) return null;
    if (current < prev) total -= current;
    else total += current;
    prev = current;
  }
  if (total <= 0 || total > 100) return null;
  return total;
}

const JAPANESE_NUMBER_MAP: Record<string, number> = {
  ichi: 1,
  ni: 2,
  san: 3,
  yon: 4,
  shi: 4,
  go: 5,
  roku: 6,
  nana: 7,
  shichi: 7,
  hachi: 8,
  kyu: 9,
  ku: 9,
  juu: 10,
};

export type SeasonInfo = {
  seasonNumber: number;
  seasonPart: number | null;
};

function inferSeasonNumberFromCandidate(candidate: string): number | null {
  const direct =
    candidate.match(/\b(?:season|temporada)\s*(\d{1,2})\b/i)
    ?? candidate.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i)
    ?? candidate.match(/\bs(?:eason)?\s*0?(\d{1,2})\b/i)
    ?? candidate.match(/\b(\d{1,2})\s*no\s*shou\b/i);
  if (direct) {
    const parsed = parseSafePositiveInt(direct[1]);
    if (parsed != null) return parsed;
  }

  const romanWithKeyword = candidate.match(/\b(?:season|temporada)\s*([ivxlc]{1,5})\b/i);
  if (romanWithKeyword) {
    const parsed = parseRomanNumeral(romanWithKeyword[1]);
    if (parsed != null) return parsed;
  }

  const romanSuffix = candidate.match(/\s+(ii|iii|iv|vi{0,3}|ix|xi{0,3}|xii|xiii|xiv|xv)\s*$/i);
  if (romanSuffix) {
    const parsed = parseRomanNumeral(romanSuffix[1]);
    if (parsed != null && parsed >= 2) return parsed;
  }

  const japaneseNoShou = candidate.match(/\b([a-z]+)\s+no\s+shou\b/i);
  if (japaneseNoShou) {
    const parsed = JAPANESE_NUMBER_MAP[japaneseNoShou[1]];
    if (parsed != null) return parsed;
  }

  return null;
}

function inferSeasonPartFromCandidate(candidate: string): number | null {
  const numeric = candidate.match(/\bpart\s*(\d{1,2})\b/i);
  if (numeric) {
    const parsed = parseSafePositiveInt(numeric[1]);
    if (parsed != null) return parsed;
  }

  const roman = candidate.match(/\bpart\s*([ivxlc]{1,5})\b/i);
  if (roman) {
    const parsed = parseRomanNumeral(roman[1]);
    if (parsed != null) return parsed;
  }

  return null;
}

export function inferSeasonInfo(...candidates: Array<string | null | undefined>): SeasonInfo {
  let seasonNumber: number | null = null;
  let seasonPart: number | null = null;

  for (const rawCandidate of candidates) {
    if (!rawCandidate) continue;
    const candidate = normalizeAscii(rawCandidate);

    if (seasonNumber == null) {
      seasonNumber = inferSeasonNumberFromCandidate(candidate);
    }

    if (seasonPart == null) {
      seasonPart = inferSeasonPartFromCandidate(candidate);
    }

    if (seasonNumber != null && seasonPart != null) {
      break;
    }
  }

  return {
    seasonNumber: seasonNumber ?? 1,
    seasonPart,
  };
}

export function isSeasonDirectoryName(name: string): boolean {
  return /^season\s+\d{1,3}(?:\s+part\s+\d{1,3})?$/i.test(name.trim());
}

/**
 * Remove sufixos de temporada do título, retornando o nome base da série.
 * Garante que todas as temporadas de um mesmo anime compartilhem a mesma pasta.
 *
 * Exemplos:
 *   "Enen no Shouboutai: San no Shou Part 2" → "Enen no Shouboutai"
 *   "Overlord III"                            → "Overlord"
 *   "Attack on Titan: The Final Season"       → "Attack on Titan"
 *   "Sword Art Online: Alicization"           → "Sword Art Online"
 */
export function stripSeasonSuffix(title: string): string {
  let t = title.trim();

  // ": San no Shou", ": Ni no Shou" (nome de cour japonês)
  t = t.replace(/\s*:\s*(?:ichi|ni|san|yon|shi|go|roku|nana|shichi|hachi|kyu|ku|juu)\s+no\s+shou\b.*/i, "");

  // ": Season 3", ": 3rd Season", "Season 3" após dois-pontos/hífen
  t = t.replace(/\s*[-:]?\s*\d{1,2}(?:st|nd|rd|th)?\s+season\b.*/i, "");
  t = t.replace(/\s*[-:]?\s*season\s+\d{1,2}\b.*/i, "");

  // ": The Final Season", ": Final Season"
  t = t.replace(/\s*:\s*(?:the\s+)?final\s+season\b.*/i, "");

  // ": Part 2", " Part II" no final
  t = t.replace(/\s*[-:]?\s*part\s+[\divxlc]+\s*$/i, "");

  // Sufixo com dois-pontos genérico que indica arco/temporada (ex: ": Alicization", ": War of Underworld")
  // Só remove se já tinha um sufixo removido acima (ou seja, não remove o primeiro ":Subtítulo")
  // → não fazemos isso para não quebrar títulos legítimos com subtítulo

  // Algarismos romanos no final: "Overlord III", "Fate/Zero II" (exige >= II)
  t = t.replace(/\s+(?:ii|iii|iv|vi{0,3}|ix|xi{0,3}|xii|xiii|xiv|xv)\s*$/i, "");

  // Identificadores de formato/qualidade de provider: "8.13 A14", "7.2 B03"
  t = t.replace(/\s+\d{1,2}\.\d{1,3}\s+[A-Za-z]\d+\s*$/g, "");

  // Ano em parênteses no final artefato de scraping: "(2026)", "(1995)"
  t = t.replace(/\s*\(\d{4}\)\s*$/, "");

  return t.trim();
}

/** Prioriza título: English > Romaji > original */
export function preferredTitle(
  titleEnglish?: string | null,
  titleRomaji?: string | null,
  titleOriginal?: string | null
): string {
  return (
    titleEnglish?.trim() ||
    titleRomaji?.trim() ||
    titleOriginal?.trim() ||
    "Unknown"
  );
}

/** Pasta da série: "Sousou no Frieren (2023)" */
export function seriesDir(title: string, year?: number | null): string {
  const clean = sanitize(title);
  return year ? `${clean} (${year})` : clean;
}

/** Pasta da temporada: "Season 01" */
export function seasonDir(season: number, seasonPart?: number | null): string {
  const base = `Season ${String(season).padStart(2, "0")}`;
  if (seasonPart == null || seasonPart <= 0) return base;
  return `${base} Part ${String(seasonPart).padStart(2, "0")}`;
}

/** Nome do arquivo de episódio: "Sousou no Frieren S01E05.mkv" */
export function episodeFilename(
  title: string,
  season: number,
  episode: number,
  ext = "mkv"
): string {
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  return `${sanitize(title)} S${s}E${e}.${ext}`;
}

/** Nome do arquivo de episódio com título: "Sousou no Frieren S01E05 - The Land Where Elves Live.mkv" */
export function episodeFilenameWithTitle(
  seriesTitle: string,
  season: number,
  episode: number,
  episodeTitle?: string | null,
  ext = "mkv"
): string {
  const base = episodeFilename(seriesTitle, season, episode, ext).replace(`.${ext}`, "");
  if (episodeTitle?.trim()) {
    return `${base} - ${sanitize(episodeTitle)}.${ext}`;
  }
  return `${base}.${ext}`;
}

/** Caminho completo de episódio relativo à base */
export function episodePath(
  basePath: string,
  title: string,
  year: number | null | undefined,
  season: number,
  seasonPart: number | null | undefined,
  episode: number,
  episodeTitle?: string | null,
  ext = "mkv"
): string {
  return join(
    basePath,
    seriesDir(title, year),
    seasonDir(season, seasonPart),
    episodeFilenameWithTitle(title, season, episode, episodeTitle, ext)
  );
}

/** Pasta de filme: "Movies/Spirited Away (2001)" */
export function movieDir(title: string, year?: number | null): string {
  return join("Movies", seriesDir(title, year));
}

/** Nome do arquivo de filme: "Spirited Away (2001).mkv" */
export function movieFilename(title: string, year?: number | null, ext = "mkv"): string {
  const clean = sanitize(title);
  return year ? `${clean} (${year}).${ext}` : `${clean}.${ext}`;
}

/** Caminho completo de filme */
export function moviePath(
  basePath: string,
  title: string,
  year: number | null | undefined,
  ext = "mkv"
): string {
  return join(basePath, movieDir(title, year), movieFilename(title, year, ext));
}

/** Detecta se um filename já está no formato Jellyfin S##E## */
export function isJellyfinNamed(filename: string): boolean {
  return /S\d{1,3}E\d{1,4}/i.test(filename);
}

/** Extrai season/episode de um filename no formato S##E## (suporta 1–3 dígitos de season e 1–4 de episódio) */
export function parseEpisodeFromFilename(filename: string): { season: number; episode: number } | null {
  const m = filename.match(/S(\d{1,3})E(\d{1,4})/i);
  if (!m) return null;
  const season = parseInt(m[1], 10);
  const episode = parseInt(m[2], 10);
  if (season <= 0 || season > 999 || episode <= 0 || episode > 9999) return null;
  return { season, episode };
}

/** Sugere nome Jellyfin dado nome de arquivo original */
export function suggestRename(
  originalFilename: string,
  seriesTitle: string,
  season: number,
  year?: number | null
): string | null {
  const parsed = parseEpisodeFromFilename(originalFilename);
  if (!parsed) {
    // Tenta extrair número do episódio de padrões comuns
    const patterns = [
      /[Ee][Pp]?\.?\s*(\d{1,3})/,     // ep.12, EP12, Ep 12
      /[-_\s](\d{2,3})[.-_\s]/,        // -12-, _12_, 12.mkv
      /\[(\d{1,3})\]/,                  // [12]
    ];
    for (const re of patterns) {
      const m = originalFilename.match(re);
      if (m) {
        const ep = parseInt(m[1]);
        return episodeFilename(seriesTitle, season, ep);
      }
    }
    return null;
  }
  return episodeFilename(seriesTitle, parsed.season, parsed.episode);
}

export type NamingScheme = "jellyfin" | "plex" | "simple";

/**
 * Remove componentes de Season/Série que o usuário pode ter incluído acidentalmente
 * no download_path (ex: "D:/Anime/Overlord (2015)/Season 03" → "D:/Anime").
 * Garante que buildPath não duplique esses segmentos.
 */
function normalizeDownloadBase(basePath: string, title: string, year: number | null | undefined): string {
  let p = basePath.trim().replace(/[/\\]+$/, "");

  // Remove todos os níveis de "Season XX" / "Season XX Part YY" no final do caminho
  while (true) {
    const parts = p.split(/[/\\]/);
    const last = parts[parts.length - 1];
    if (!last || !isSeasonDirectoryName(last)) break;
    parts.pop();
    p = parts.join(p.includes("\\") ? "\\" : "/");
  }

  // Remove trailing pasta de série que corresponda ao título base (com ou sem ano)
  const baseTitle = stripSeasonSuffix(title);
  const candidates = [
    sanitize(baseTitle),
    seriesDir(sanitize(baseTitle), year),
  ];
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(/[/\\]/);
  if (parts.length > 1 && candidates.includes(parts[parts.length - 1])) {
    parts.pop();
    p = parts.join(sep);
  }

  return p || basePath;
}

export function buildPath(
  scheme: NamingScheme,
  basePath: string,
  title: string,
  year: number | null | undefined,
  season: number,
  episode: number,
  episodeTitle?: string | null,
  ext = "mkv",
  seasonPart?: number | null
): string {
  // Título base sem sufixo de temporada: todas as temporadas ficam na mesma pasta
  const baseTitle = stripSeasonSuffix(title);

  switch (scheme) {
    case "simple":
      return join(basePath, sanitize(baseTitle), `EP${String(episode).padStart(2, "0")}.${ext}`);
    case "plex":
    case "jellyfin":
    default: {
      // normalizeDownloadBase remove Season XX / pasta de série duplicada do basePath
      const cleanBase = normalizeDownloadBase(basePath, baseTitle, null);
      // year=null: não inclui "(Ano)" na pasta da série, garantindo que S1 (2019) e
      // S3 (2020) do mesmo anime caiam em "Titulo/Season 01" e "Titulo/Season 03"
      return episodePath(cleanBase, baseTitle, null, season, seasonPart ?? null, episode, episodeTitle, ext);
    }
  }
}
