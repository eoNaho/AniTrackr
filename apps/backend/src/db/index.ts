import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
const dataRoot = process.env.ANITRACKR_DATA_DIR?.trim() || home;
const defaultDownloadPath = process.env.ANITRACKR_DOWNLOAD_PATH?.trim() || join(home, "Anime");
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
  quality:          "1080p",
  provider:         "animefire",
  max_concurrent:   "3",
  language:         "pt-BR",
  naming_scheme:    "jellyfin",
  prefer_sub:       "true",
  allow_simulated_downloads: "true",
  yt_dlp_path:      "yt-dlp",
  ffmpeg_path:      "ffmpeg",
  auto_retry_enabled: "true",
  retry_max_attempts: "3",
  retry_base_delay_seconds: "20",
  retry_max_delay_seconds: "900",
  // qBittorrent
  qbittorrent_enabled:  "false",
  qbittorrent_host:     "http://localhost:8080",
  qbittorrent_username: "admin",
  qbittorrent_password: "adminadmin",
  qbittorrent_save_path: "",
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

export default db;
