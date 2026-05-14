import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
const dbDir = join(home, ".goanime");
mkdirSync(dbDir, { recursive: true });

export const db = new Database(join(dbDir, "tracker.db"), { create: true });

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
    FOREIGN KEY (anime_id) REFERENCES animes(id) ON DELETE CASCADE
  )
`);

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
  download_path:    join(home, "Anime"),
  quality:          "1080p",
  provider:         "animefire",
  max_concurrent:   "3",
  language:         "pt-BR",
  naming_scheme:    "jellyfin",   // jellyfin | plex | simple
  prefer_sub:       "true",
  yt_dlp_path:      "yt-dlp",
  ffmpeg_path:      "ffmpeg",
};

const insertCfg = db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES ($k, $v)`);
for (const [k, v] of Object.entries(defaultConfig)) {
  insertCfg.run({ $k: k, $v: v });
}

// ── seed mock data ─────────────────────────────────────────────────────────
function seedMockAnimes() {
  const { count } = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM animes`).get()!;
  if (count > 0) return;

  const ins = db.prepare(`
    INSERT OR IGNORE INTO animes (
      id, kitsu_id, anilist_id, title, title_english, title_romaji,
      alt_title, synopsis, genres, tags, rating, kitsu_status, anilist_status,
      subtype, episode_count, episode_length, downloaded_count, download_status,
      quality, provider, size_gb, local_path, year, season_number,
      next_release, last_download, ascii_art
    ) VALUES (
      $id, $kitsu_id, $anilist_id, $title, $title_english, $title_romaji,
      $alt_title, $synopsis, $genres, $tags, $rating, $kitsu_status, $anilist_status,
      $subtype, $episode_count, $episode_length, $downloaded_count, $download_status,
      $quality, $provider, $size_gb, $local_path, $year, $season_number,
      $next_release, $last_download, $ascii_art
    )
  `);

  const seed = [
    {
      $id: "frieren-s01", $kitsu_id: "46065", $anilist_id: 154587,
      $title: "Sousou no Frieren", $title_english: "Frieren: Beyond Journey's End", $title_romaji: "Sousou no Frieren",
      $alt_title: "Frieren: Beyond Journey's End",
      $synopsis: "Tracker local de episódios baixados. Frieren possui 24 episódios salvos, 4 pendentes e 1 lançamento previsto para hoje.",
      $genres: JSON.stringify(["Adventure", "Drama", "Fantasy"]),
      $tags: JSON.stringify(["Adventure", "Drama", "Fantasy", "Magic"]),
      $rating: 9.2, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 28, $episode_length: 24,
      $downloaded_count: 24, $download_status: "Downloading",
      $quality: "1080p HEVC", $provider: "animefire", $size_gb: 18.4,
      $local_path: join(home, "Anime", "Sousou no Frieren (2023)", "Season 01"),
      $year: 2023, $season_number: 1,
      $next_release: "Hoje, 23:00", $last_download: "Hoje, 14:22",
      $ascii_art: "   /\\_\\\n  ( o.o )\n   > ^ <\n  /  _  \\\n /_| |_\\_\\",
    },
    {
      $id: "solo-leveling-s01", $kitsu_id: "43860", $anilist_id: 166240,
      $title: "Solo Leveling", $title_english: "Solo Leveling", $title_romaji: "Ore dake Level Up na Ken",
      $alt_title: "Ore dake Level Up na Ken",
      $synopsis: "Série na fila para completar a temporada. O tracker detectou 4 episódios faltando e mantém os metadados sincronizados.",
      $genres: JSON.stringify(["Action", "Dark Fantasy", "Adventure"]),
      $tags: JSON.stringify(["Action", "System", "Dark Fantasy", "OP MC"]),
      $rating: 8.5, $kitsu_status: "current", $anilist_status: "RELEASING",
      $subtype: "TV", $episode_count: 12, $episode_length: 22,
      $downloaded_count: 8, $download_status: "Queued",
      $quality: "1080p AVC", $provider: "animefire", $size_gb: 9.1,
      $local_path: join(home, "Anime", "Solo Leveling (2024)", "Season 01"),
      $year: 2024, $season_number: 1,
      $next_release: "Sábado", $last_download: "Ontem, 22:10",
      $ascii_art: "   /| ________________\n O|===|* >________________>\n   \\|",
    },
    {
      $id: "jjk-s02", $kitsu_id: "43608", $anilist_id: 145064,
      $title: "Jujutsu Kaisen 2nd Season", $title_english: "Jujutsu Kaisen Season 2", $title_romaji: "Jujutsu Kaisen 2nd Season",
      $alt_title: "JJK S2: Shibuya Incident",
      $synopsis: "Temporada completa no disco. Nenhum episódio faltando, pronto para backup, exportação ou rescan da biblioteca.",
      $genres: JSON.stringify(["Action", "Supernatural", "School"]),
      $tags: JSON.stringify(["Action", "Supernatural", "Gore", "Cursed Energy"]),
      $rating: 9.5, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 47, $episode_length: 23,
      $downloaded_count: 47, $download_status: "Downloaded",
      $quality: "1080p HEVC", $provider: "animefire", $size_gb: 31.8,
      $local_path: join(home, "Anime", "Jujutsu Kaisen (2023)", "Season 02"),
      $year: 2023, $season_number: 2,
      $next_release: null, $last_download: "11 Maio",
      $ascii_art: "   ///\\\\\n  | 0 0 |\n   \\_-_/\n   /|||\\",
    },
    {
      $id: "dungeon-meshi-s01", $kitsu_id: "44578", $anilist_id: 153518,
      $title: "Dungeon Meshi", $title_english: "Delicious in Dungeon", $title_romaji: "Dungeon Meshi",
      $alt_title: "Delicious in Dungeon",
      $synopsis: "Download incompleto. O tracker encontrou episódios ausentes entre o 12 e o 24 e sugere um batch download.",
      $genres: JSON.stringify(["Comedy", "Fantasy", "Adventure"]),
      $tags: JSON.stringify(["Comedy", "Fantasy", "Food", "Dungeon"]),
      $rating: 9.0, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 24, $episode_length: 24,
      $downloaded_count: 11, $download_status: "Missing",
      $quality: "720p AVC", $provider: "goyabu", $size_gb: 7.6,
      $local_path: join(home, "Anime", "Dungeon Meshi (2024)", "Season 01"),
      $year: 2024, $season_number: 1,
      $next_release: "Quinta-feira", $last_download: "Segunda, 19:40",
      $ascii_art: "   ( )\n  (   )\n (_____)\n  |___|",
    },
    {
      $id: "vinland-s02", $kitsu_id: "45891", $anilist_id: 136430,
      $title: "Vinland Saga Season 2", $title_english: "Vinland Saga Season 2", $title_romaji: "Vinland Saga Season 2",
      $alt_title: "Farmland Arc",
      $synopsis: "Download pausado manualmente. Ainda faltam 10 episódios para fechar a temporada local.",
      $genres: JSON.stringify(["Historical", "Drama", "Action"]),
      $tags: JSON.stringify(["Historical", "Drama", "Seinen", "Vikings"]),
      $rating: 9.7, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 24, $episode_length: 23,
      $downloaded_count: 14, $download_status: "Paused",
      $quality: "1080p AVC", $provider: "animefire", $size_gb: 13.2,
      $local_path: join(home, "Anime", "Vinland Saga (2023)", "Season 02"),
      $year: 2023, $season_number: 2,
      $next_release: null, $last_download: "08 Maio",
      $ascii_art: "  /\\____/\\\n /  o  o  \\\n \\  --   /\n  /|____|\\",
    },
    {
      $id: "oshi-no-ko-s01", $kitsu_id: "44491", $anilist_id: 150672,
      $title: "Oshi no Ko", $title_english: "Oshi no Ko", $title_romaji: "Oshi no Ko",
      $alt_title: "My Star",
      $synopsis: "Idol reincarnation story. Download completo da primeira temporada com 11 episódios.",
      $genres: JSON.stringify(["Drama", "Mystery", "Supernatural"]),
      $tags: JSON.stringify(["Idol", "Reincarnation", "Drama", "Mystery"]),
      $rating: 8.9, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 11, $episode_length: 45,
      $downloaded_count: 11, $download_status: "Downloaded",
      $quality: "1080p HEVC", $provider: "animefire", $size_gb: 12.3,
      $local_path: join(home, "Anime", "Oshi no Ko (2023)", "Season 01"),
      $year: 2023, $season_number: 1,
      $next_release: null, $last_download: "25 Abril",
      $ascii_art: "   ★彡\n  (◕‿◕)\n  /|  |\\\n   |  |",
    },
    {
      $id: "chainsaw-s01", $kitsu_id: "42522", $anilist_id: 127230,
      $title: "Chainsaw Man", $title_english: "Chainsaw Man", $title_romaji: "Chainsaw Man",
      $alt_title: "CSM",
      $synopsis: "Shonen de ação e horror. Temporada 1 completa no disco local.",
      $genres: JSON.stringify(["Action", "Horror", "Supernatural"]),
      $tags: JSON.stringify(["Action", "Horror", "Demons", "Dark"]),
      $rating: 8.7, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 12, $episode_length: 24,
      $downloaded_count: 12, $download_status: "Downloaded",
      $quality: "1080p HEVC", $provider: "animefire", $size_gb: 9.8,
      $local_path: join(home, "Anime", "Chainsaw Man (2022)", "Season 01"),
      $year: 2022, $season_number: 1,
      $next_release: null, $last_download: "03 Março",
      $ascii_art: "  /|\n  ||----\n  ||VROOM\n  \\|",
    },
    {
      $id: "spy-family-s01", $kitsu_id: "44511", $anilist_id: 142838,
      $title: "SPY×FAMILY", $title_english: "SPY×FAMILY", $title_romaji: "Spy x Family",
      $alt_title: "Spy Family",
      $synopsis: "Comédia de espionagem familiar. Baixando segunda parte da primeira temporada.",
      $genres: JSON.stringify(["Comedy", "Action", "Slice of Life"]),
      $tags: JSON.stringify(["Spy", "Family", "Comedy", "Esper"]),
      $rating: 8.6, $kitsu_status: "finished", $anilist_status: "FINISHED",
      $subtype: "TV", $episode_count: 25, $episode_length: 24,
      $downloaded_count: 13, $download_status: "Missing",
      $quality: "1080p AVC", $provider: "goyabu", $size_gb: 10.1,
      $local_path: join(home, "Anime", "SPY×FAMILY (2022)", "Season 01"),
      $year: 2022, $season_number: 1,
      $next_release: null, $last_download: "18 Abril",
      $ascii_art: "  (>_<)\n  /|★|\\\n   |  |\n  / \\/ \\",
    },
  ];

  for (const row of seed) {
    ins.run(row as Parameters<typeof ins.run>[0]);
  }

  // Seed alguns episódios para o Frieren
  const insEp = db.prepare(`
    INSERT OR IGNORE INTO episodes (id, anime_id, number, season, title, status, file_path)
    VALUES ($id, $anime_id, $number, $season, $title, $status, $file_path)
  `);

  for (let ep = 1; ep <= 28; ep++) {
    const downloaded = ep <= 24;
    insEp.run({
      $id: `frieren-s01-ep${ep}`,
      $anime_id: "frieren-s01",
      $number: ep,
      $season: 1,
      $title: `Episode ${ep}`,
      $status: downloaded ? "downloaded" : "missing",
      $file_path: downloaded
        ? join(home, "Anime", "Sousou no Frieren (2023)", "Season 01", `Sousou no Frieren S01E${String(ep).padStart(2,"0")}.mkv`)
        : "",
    });
  }
}

seedMockAnimes();

export default db;
