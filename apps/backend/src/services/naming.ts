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
export function seasonDir(season: number): string {
  return `Season ${String(season).padStart(2, "0")}`;
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
  episode: number,
  episodeTitle?: string | null,
  ext = "mkv"
): string {
  return join(
    basePath,
    seriesDir(title, year),
    seasonDir(season),
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
  return /S\d{2}E\d{2}/i.test(filename);
}

/** Extrai season/episode de um filename no formato S##E## */
export function parseEpisodeFromFilename(filename: string): { season: number; episode: number } | null {
  const m = filename.match(/S(\d{2})E(\d{2})/i);
  if (!m) return null;
  return { season: parseInt(m[1]), episode: parseInt(m[2]) };
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

export function buildPath(
  scheme: NamingScheme,
  basePath: string,
  title: string,
  year: number | null | undefined,
  season: number,
  episode: number,
  episodeTitle?: string | null,
  ext = "mkv"
): string {
  switch (scheme) {
    case "simple":
      return join(basePath, sanitize(title), `EP${String(episode).padStart(2, "0")}.${ext}`);
    case "plex":
    case "jellyfin":
    default:
      return episodePath(basePath, title, year, season, episode, episodeTitle, ext);
  }
}
