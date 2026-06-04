import { readdirSync, statSync, renameSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import db from "../db/index.ts";
import { logger } from "../utils/logger.ts";
import {
  isJellyfinNamed,
  suggestRename,
  parseEpisodeFromFilename,
  episodeFilenameWithTitle,
  sanitize,
  isMovie,
} from "./naming.ts";
import { randomUUID } from "crypto";

export const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm"]);

export interface ScanResult {
  animeId: string;
  filesFound: number;
  filesNew: number;
  filesAlreadyTracked: number;
  missingEpisodes: number[];
  totalEpisodes: number;
}

export interface RenameResult {
  animeId: string;
  renamed: { from: string; to: string }[];
  skipped: string[];
  errors: { file: string; error: string }[];
}

export interface LibraryFile {
  path: string;
  filename: string;
  sizeMb: number;
  episode: number | null;
  season: number | null;
  isJellyfin: boolean;
}

/** Lista todos os arquivos de vídeo em um diretório recursivamente */
function listVideoFiles(dirPath: string, depth = 0): LibraryFile[] {
  if (depth > 4 || !existsSync(dirPath)) return [];
  const files: LibraryFile[] = [];
  try {
    for (const entry of readdirSync(dirPath)) {
      const full = join(dirPath, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...listVideoFiles(full, depth + 1));
      } else if (VIDEO_EXTENSIONS.has(extname(entry).toLowerCase())) {
        const parsed = parseEpisodeFromFilename(entry);
        files.push({
          path: full,
          filename: entry,
          sizeMb: Math.round(stat.size / 1024 / 1024),
          episode: parsed?.episode ?? null,
          season: parsed?.season ?? null,
          isJellyfin: isJellyfinNamed(entry),
        });
      }
    }
  } catch (err) {
    logger.warn("scanner", `Error reading ${dirPath}: ${err}`);
  }
  return files;
}

/** Escaneia o path local de um anime e sincroniza com o banco de dados */
export async function scanAnime(animeId: string): Promise<ScanResult> {
  const anime = db.query<{
    id: string; title: string; title_english: string | null;
    local_path: string; episode_count: number; season_number: number; year: number | null; subtype: string | null;
  }, [string]>(`SELECT id, title, title_english, local_path, episode_count, season_number, year, subtype FROM animes WHERE id = ?`).get(animeId);

  if (!anime) throw new Error(`Anime ${animeId} não encontrado`);

  const animeIsMovie = isMovie(anime.subtype);

  const localPath = anime.local_path;
  if (!localPath || !existsSync(localPath)) {
    logger.warn("scanner", `Path não existe: ${localPath}`);
    return { animeId, filesFound: 0, filesNew: 0, filesAlreadyTracked: 0, missingEpisodes: [], totalEpisodes: anime.episode_count };
  }

  logger.info("scanner", `Scanning ${localPath} for ${anime.title}`);
  const files = listVideoFiles(localPath);

  let filesNew = 0;
  let filesAlreadyTracked = 0;

  const upsertEp = db.prepare(`
    INSERT INTO episodes (id, anime_id, number, season, status, file_path, file_size_mb)
    VALUES ($id, $anime_id, $number, $season, 'downloaded', $file_path, $file_size_mb)
    ON CONFLICT(anime_id, number, season) DO UPDATE SET
      status = 'downloaded',
      file_path = excluded.file_path,
      file_size_mb = excluded.file_size_mb
  `);

  // Filmes não têm S##E## no nome — o maior arquivo de vídeo é tratado como "episódio 1".
  const orderedFiles = animeIsMovie ? [...files].sort((a, b) => b.sizeMb - a.sizeMb) : files;
  let movieAssigned = false;

  for (const file of orderedFiles) {
    let epNumber = file.episode;
    let epSeason = file.season ?? anime.season_number;
    if (epNumber == null && animeIsMovie && !movieAssigned) {
      epNumber = 1;
      epSeason = 1;
      movieAssigned = true;
    }
    if (epNumber == null) continue;

    const existing = db.query<{ id: string }, [string, number, number]>(
      `SELECT id FROM episodes WHERE anime_id = ? AND number = ? AND season = ?`
    ).get(animeId, epNumber, epSeason);

    if (existing) {
      filesAlreadyTracked++;
    } else {
      filesNew++;
    }

    upsertEp.run({
      $id: existing?.id ?? randomUUID(),
      $anime_id: animeId,
      $number: epNumber,
      $season: epSeason,
      $file_path: file.path,
      $file_size_mb: file.sizeMb,
    });
  }

  // Atualiza downloaded_count
  const { count } = db.query<{ count: number }, [string]>(
    `SELECT COUNT(*) as count FROM episodes WHERE anime_id = ? AND status = 'downloaded'`
  ).get(animeId)!;

  db.run(`UPDATE animes SET downloaded_count = ?, updated_at = datetime('now') WHERE id = ?`, [count, animeId]);

  // Calcula episódios faltando
  const downloadedNums = db.query<{ number: number }, [string]>(
    `SELECT number FROM episodes WHERE anime_id = ? AND status = 'downloaded' ORDER BY number`
  ).all(animeId).map((r) => r.number);

  const missingEpisodes: number[] = [];
  for (let ep = 1; ep <= anime.episode_count; ep++) {
    if (!downloadedNums.includes(ep)) missingEpisodes.push(ep);
  }

  // Log do scan
  db.run(`
    INSERT INTO scan_log (id, anime_id, scan_type, files_found, files_new, message)
    VALUES (?, ?, 'anime', ?, ?, ?)
  `, [randomUUID(), animeId, files.length, filesNew, `Scan completo: ${count}/${anime.episode_count} eps encontrados`]);

  logger.info("scanner", `${anime.title}: ${files.length} files, ${filesNew} new, ${missingEpisodes.length} missing`);

  return {
    animeId,
    filesFound: files.length,
    filesNew,
    filesAlreadyTracked,
    missingEpisodes,
    totalEpisodes: anime.episode_count,
  };
}

/** Escaneia toda a biblioteca */
export async function scanFullLibrary(): Promise<{ total: ScanResult[]; summary: { scanned: number; totalFiles: number; newFiles: number; missingEps: number } }> {
  const animes = db.query<{ id: string }, []>(`SELECT id FROM animes WHERE local_path != '' AND is_tracked = 1`).all();

  const results: ScanResult[] = [];
  for (const { id } of animes) {
    try {
      const r = await scanAnime(id);
      results.push(r);
    } catch (err) {
      logger.warn("scanner", `scanAnime(${id}) failed: ${err}`);
    }
  }

  return {
    total: results,
    summary: {
      scanned: results.length,
      totalFiles: results.reduce((s, r) => s + r.filesFound, 0),
      newFiles: results.reduce((s, r) => s + r.filesNew, 0),
      missingEps: results.reduce((s, r) => s + r.missingEpisodes.length, 0),
    },
  };
}

/** Renomeia episódios para nomenclatura Jellyfin */
export async function renameToJellyfin(animeId: string, dryRun = false): Promise<RenameResult> {
  const anime = db.query<{
    id: string; title: string; title_english: string | null;
    local_path: string; season_number: number; year: number | null;
  }, [string]>(`SELECT id, title, title_english, local_path, season_number, year FROM animes WHERE id = ?`).get(animeId);

  if (!anime) throw new Error(`Anime ${animeId} não encontrado`);

  const title = anime.title_english ?? anime.title;
  const files = listVideoFiles(anime.local_path);

  const result: RenameResult = { animeId, renamed: [], skipped: [], errors: [] };

  for (const file of files) {
    if (isJellyfinNamed(file.filename)) {
      result.skipped.push(file.filename);
      continue;
    }

    const suggestion = suggestRename(file.filename, title, anime.season_number, anime.year);
    if (!suggestion) {
      result.skipped.push(file.filename);
      continue;
    }

    const ext = extname(file.filename).toLowerCase();
    const targetFilename = suggestion.replace(/\.\w+$/, "") + ext;
    const targetPath = join(file.path.replace(file.filename, ""), targetFilename);

    if (!dryRun) {
      try {
        renameSync(file.path, targetPath);
        // Atualiza no banco
        db.run(`UPDATE episodes SET file_path = ? WHERE file_path = ?`, [targetPath, file.path]);
        logger.info("scanner", `Renamed: ${file.filename} → ${targetFilename}`);
      } catch (err) {
        result.errors.push({ file: file.filename, error: String(err) });
        continue;
      }
    }

    result.renamed.push({ from: file.filename, to: targetFilename });
  }

  // Log do rename
  db.run(`
    INSERT INTO scan_log (id, anime_id, scan_type, files_renamed, message)
    VALUES (?, ?, 'rename', ?, ?)
  `, [randomUUID(), animeId, result.renamed.length, `Renamed ${result.renamed.length} files (dryRun=${dryRun})`]);

  return result;
}

/** Lista todos os arquivos de vídeo de um path arbitrário */
export function listFiles(dirPath: string): LibraryFile[] {
  return listVideoFiles(dirPath);
}

/** Retorna episódios faltando para um anime */
export function getMissingEpisodes(animeId: string): number[] {
  const anime = db.query<{ episode_count: number }, [string]>(
    `SELECT episode_count FROM animes WHERE id = ?`
  ).get(animeId);
  if (!anime) return [];

  const downloaded = db.query<{ number: number }, [string]>(
    `SELECT number FROM episodes WHERE anime_id = ? AND status = 'downloaded'`
  ).all(animeId).map((r) => r.number);

  const missing: number[] = [];
  for (let ep = 1; ep <= anime.episode_count; ep++) {
    if (!downloaded.includes(ep)) missing.push(ep);
  }
  return missing;
}
