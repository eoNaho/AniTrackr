import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
const isDockerRuntime = process.env.ANITRACKR_RUNTIME?.trim() === "docker" || existsSync("/.dockerenv");
const dataRoot = process.env.ANITRACKR_DATA_DIR?.trim() || home;
const defaultDownloadPath = process.env.ANITRACKR_DOWNLOAD_PATH?.trim() || join(home, "Anime");
const defaultMediaPath = process.env.ANITRACKR_MEDIA_PATH?.trim() || "";
const defaultQbHost = process.env.ANITRACKR_QBITTORRENT_HOST?.trim()
  || (isDockerRuntime ? "http://qbittorrent:8080" : "http://localhost:8080");
const defaultQbEnabled = process.env.ANITRACKR_QBITTORRENT_ENABLED?.trim() || "false";
const defaultQbSavePath = process.env.ANITRACKR_QBITTORRENT_SAVE_PATH?.trim() || "";
const dbDir = join(dataRoot, ".anitrackr");
const dbFile = join(dbDir, "tracker.db");
mkdirSync(dbDir, { recursive: true });

export const DB_FILE = dbFile;
export const DATA_ROOT = dataRoot;
export const db = new Database(dbFile, { create: true });

db.run(`PRAGMA journal_mode = WAL`);
db.run(`PRAGMA foreign_keys = ON`);
db.run(`PRAGMA cache_size = -32000`);
db.run(`PRAGMA synchronous = NORMAL`);

// ── animes ──────────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS animes (
    id              TEXT PRIMARY KEY,
    kitsu_id        TEXT,
    anilist_id      INTEGER,
    mal_id          INTEGER,
    title           TEXT NOT NULL,
    title_romaji    TEXT,
    title_english   TEXT,
    title_native    TEXT,
    alt_title       TEXT,
    synopsis        TEXT,
    poster_url      TEXT,
    cover_url       TEXT,
    genres          TEXT DEFAULT '[]',
    tags            TEXT DEFAULT '[]',
    rating          REAL DEFAULT 0,
    kitsu_status    TEXT DEFAULT 'unknown',
    anilist_status  TEXT DEFAULT 'unknown',
    subtype         TEXT DEFAULT 'TV',
    episode_count   INTEGER DEFAULT 0,
    episode_length  INTEGER,
    downloaded_count INTEGER DEFAULT 0,
    download_status TEXT DEFAULT 'Missing',
    quality         TEXT DEFAULT '1080p',
    provider        TEXT DEFAULT 'animefire',
    size_gb         REAL DEFAULT 0,
    local_path      TEXT DEFAULT '',
    year            INTEGER,
    season_number   INTEGER DEFAULT 1,
    next_release    TEXT,
    last_download   TEXT,
    ascii_art       TEXT DEFAULT '',
    source_url      TEXT,
    is_tracked      INTEGER DEFAULT 1,
    cached_at       TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  )
`);

// ── episodes: tracking granular por episódio ──────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS episodes (
    id              TEXT PRIMARY KEY,
    anime_id        TEXT NOT NULL,
    number          INTEGER NOT NULL,
    season          INTEGER DEFAULT 1,
    title           TEXT,
    synopsis        TEXT,
    aired           TEXT,
    duration_min    INTEGER,
    is_filler       INTEGER DEFAULT 0,
    is_recap        INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'missing',
    file_path       TEXT,
    file_size_mb    REAL DEFAULT 0,
    download_id     TEXT,
    watched         INTEGER DEFAULT 0,
    watch_progress  INTEGER DEFAULT 0,
    cached_at       TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE,
    UNIQUE(anime_id, number, season)
  )
`);

// ── downloads ──────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS downloads (
    id              TEXT PRIMARY KEY,
    anime_id        TEXT NOT NULL,
    episode_number  INTEGER NOT NULL,
    season          INTEGER DEFAULT 1,
    file_path       TEXT DEFAULT '',
    status          TEXT DEFAULT 'queued',
    progress        REAL DEFAULT 0,
    speed_kbps      REAL DEFAULT 0,
    total_bytes     INTEGER DEFAULT 0,
    downloaded_bytes INTEGER DEFAULT 0,
    error_msg       TEXT,
    provider        TEXT DEFAULT 'animefire',
    source_url      TEXT,
    quality         TEXT DEFAULT '1080p',
    started_at      TEXT,
    completed_at    TEXT,
    attempt_count   INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    next_retry_at   TEXT,
    last_error_code TEXT,
    FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
  )
`);

function ensureColumn(table: string, column: string, ddl: string) {
  const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  const hasColumn = columns.some((c) => c.name === column);
  if (!hasColumn) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn("downloads", "attempt_count", "attempt_count INTEGER DEFAULT 0");
ensureColumn("downloads", "max_attempts", "max_attempts INTEGER DEFAULT 3");
ensureColumn("downloads", "next_retry_at", "next_retry_at TEXT");
ensureColumn("downloads", "last_error_code", "last_error_code TEXT");
ensureColumn("downloads", "download_type", "download_type TEXT DEFAULT 'ytdlp'");
ensureColumn("downloads", "torrent_hash", "torrent_hash TEXT");
ensureColumn("downloads", "magnet_link", "magnet_link TEXT");
ensureColumn("animes", "mal_id", "mal_id INTEGER");
// Título base da série (sem sufixo de temporada) — usado para nomeação de pastas
// Populado a partir das relações AniList (cadeia PREQUEL) para garantir que todas as
// temporadas de um mesmo anime compartilhem a mesma pasta raiz.
ensureColumn("animes", "series_title", "series_title TEXT DEFAULT ''");
ensureColumn("animes", "watch_status", "watch_status TEXT DEFAULT 'none'");
ensureColumn("downloads", "source", "source TEXT DEFAULT 'manual'");
// ── Phase 1: Smart Rules + Queue Profiles ────────────────────────────────────
ensureColumn("anime_rules", "min_quality", "min_quality TEXT");
ensureColumn("anime_rules", "preferred_fansub", "preferred_fansub TEXT");
ensureColumn("anime_rules", "download_window_start", "download_window_start TEXT");
ensureColumn("anime_rules", "download_window_end", "download_window_end TEXT");
ensureColumn("anime_rules", "daily_limit", "daily_limit INTEGER DEFAULT 0");
ensureColumn("anime_rules", "skip_fillers", "skip_fillers INTEGER DEFAULT 0");
ensureColumn("anime_rules", "skip_recaps", "skip_recaps INTEGER DEFAULT 0");
ensureColumn("anime_rules", "notes", "notes TEXT");
ensureColumn("downloads", "enqueued_at", "enqueued_at TEXT");

function syncConfigDefault(key: string, nextValue: string, legacyValues: string[]) {
  const row = db.query<{ value: string }, [string]>(`SELECT value FROM config WHERE key = ?`).get(key);
  if (!row) return;
  if (!legacyValues.includes(row.value)) return;
  db.run(`UPDATE config SET value = ? WHERE key = ?`, [nextValue, key]);
}

// ── anime_rules ────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS anime_rules (
    anime_id               TEXT PRIMARY KEY REFERENCES animes(id) ON DELETE CASCADE,
    preferred_provider     TEXT,
    preferred_quality      TEXT,
    preferred_download_type TEXT,
    preferred_language     TEXT,
    auto_download          INTEGER DEFAULT 1,
    queue_priority         INTEGER DEFAULT 0
  )
`);

// ── queue_profiles ─────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS queue_profiles (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    label               TEXT NOT NULL,
    max_concurrent      INTEGER DEFAULT 3,
    speed_limit_kbps    INTEGER DEFAULT 0,
    window_start        TEXT,
    window_end          TEXT,
    preferred_type      TEXT DEFAULT 'ytdlp',
    retry_max           INTEGER DEFAULT 3,
    retry_base_delay_s  INTEGER DEFAULT 20,
    is_active           INTEGER DEFAULT 0,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
  )
`);

// Seed default profiles once
if ((db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM queue_profiles`).get()?.count ?? 0) === 0) {
  db.run(`INSERT INTO queue_profiles (id,name,label,max_concurrent,speed_limit_kbps,window_start,window_end,preferred_type,retry_max,retry_base_delay_s,is_active) VALUES ('home','home','Casa',3,0,NULL,NULL,'ytdlp',3,20,1)`);
  db.run(`INSERT INTO queue_profiles (id,name,label,max_concurrent,speed_limit_kbps,window_start,window_end,preferred_type,retry_max,retry_base_delay_s,is_active) VALUES ('server','server','Servidor',8,0,NULL,NULL,'ytdlp',5,10,0)`);
  db.run(`INSERT INTO queue_profiles (id,name,label,max_concurrent,speed_limit_kbps,window_start,window_end,preferred_type,retry_max,retry_base_delay_s,is_active) VALUES ('night','night','Noturno',6,0,'00:00','07:00','ytdlp',5,15,0)`);
}

db.run(`CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_downloads_retry_at ON downloads(next_retry_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_downloads_episode ON downloads(anime_id, season, episode_number)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_downloads_type_status ON downloads(download_type, status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_animes_tracked_status ON animes(is_tracked, anilist_status)`);

// ── config ─────────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// ── scan_log ───────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS scan_log (
    id         TEXT PRIMARY KEY,
    anime_id   TEXT,
    scan_type  TEXT DEFAULT 'library',
    files_found INTEGER DEFAULT 0,
    files_new   INTEGER DEFAULT 0,
    files_renamed INTEGER DEFAULT 0,
    message    TEXT,
    ran_at     TEXT DEFAULT (datetime('now'))
  )
`);

// ── default config ─────────────────────────────────────────────────────────
const defaultConfig: Record<string, string> = {
  download_path:    defaultDownloadPath,
  media_path:       defaultMediaPath,
  quality:          "1080p",
  provider:         "animefire",
  max_concurrent:   "3",
  language:         "pt-BR",
  naming_scheme:    "jellyfin",
  prefer_sub:       "true",
  allow_simulated_downloads: "false",
  yt_dlp_path:      "yt-dlp",
  ffmpeg_path:      "ffmpeg",
  auto_retry_enabled: "true",
  retry_max_attempts: "3",
  retry_base_delay_seconds: "20",
  retry_max_delay_seconds: "900",
  // qBittorrent
  qbittorrent_enabled:  defaultQbEnabled,
  qbittorrent_host:     defaultQbHost,
  qbittorrent_username: "admin",
  qbittorrent_password: "adminadmin",
  qbittorrent_save_path: defaultQbSavePath,
  // Nyaa.si
  nyaa_preferred_group:      "SubsPlease",
  nyaa_preferred_resolution: "1080p",
  nyaa_default_category:     "1_2",
};

const insertCfg = db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES ($k, $v)`);
for (const [k, v] of Object.entries(defaultConfig)) {
  insertCfg.run({ $k: k, $v: v });
}
// Nao sobrescreve valores ja configurados no banco.

if (isDockerRuntime) {
  syncConfigDefault("qbittorrent_host", defaultQbHost, ["http://localhost:8080"]);
  if (defaultQbSavePath) {
    syncConfigDefault("qbittorrent_save_path", defaultQbSavePath, [""]);
  }
  if (defaultMediaPath) {
    syncConfigDefault("media_path", defaultMediaPath, [""]);
  }
  // INSERT OR IGNORE não atualiza valores já existentes, então se o usuário
  // mudou ANITRACKR_QBITTORRENT_ENABLED no compose e reiniciou, o DB ficaria
  // com o valor antigo. Aqui garantimos que env="true" sempre prevalece.
  // Env="false" não sobrescreve "true" para preservar configuração feita pela UI.
  if (defaultQbEnabled === "true") {
    db.run(`UPDATE config SET value = 'true' WHERE key = 'qbittorrent_enabled'`);
  }
}

export type QueueProfileRow = {
  id: string; name: string; label: string;
  max_concurrent: number; speed_limit_kbps: number;
  window_start: string | null; window_end: string | null;
  preferred_type: string; retry_max: number; retry_base_delay_s: number;
  is_active: number; created_at: string; updated_at: string;
};

export function getActiveQueueProfile(): QueueProfileRow | null {
  return db.query<QueueProfileRow, []>(
    `SELECT * FROM queue_profiles WHERE is_active = 1 LIMIT 1`
  ).get() ?? null;
}

export default db;
