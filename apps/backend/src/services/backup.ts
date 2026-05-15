/**
 * Backup automático do SQLite.
 * Executa VACUUM INTO uma vez por semana, mantém os 4 últimos.
 */

import { mkdirSync, readdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import db, { DATA_ROOT } from "../db/index.ts";
import { logger } from "../utils/logger.ts";

const BACKUP_DIR = join(DATA_ROOT, ".anitrackr", "backups");
const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MAX_BACKUPS = 4;
const CONFIG_KEY = "last_backup_at";

function getLastBackup(): Date | null {
  const val = db.query<{ value: string }, [string]>(
    `SELECT value FROM config WHERE key = ?`
  ).get(CONFIG_KEY)?.value;
  return val ? new Date(val) : null;
}

function setLastBackup(ts: Date) {
  db.run(
    `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CONFIG_KEY, ts.toISOString()]
  );
}

function cleanOldBackups() {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("tracker-") && f.endsWith(".db"))
      .map((f) => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    for (const file of files.slice(MAX_BACKUPS)) {
      unlinkSync(join(BACKUP_DIR, file.name));
      logger.info("backup", `removido backup antigo: ${file.name}`);
    }
  } catch {
    // non-fatal
  }
}

export function runBackupIfDue() {
  const last = getLastBackup();
  if (last && Date.now() - last.getTime() < BACKUP_INTERVAL_MS) {
    const nextIn = Math.round((BACKUP_INTERVAL_MS - (Date.now() - last.getTime())) / 3_600_000);
    logger.info("backup", `próximo backup em ~${nextIn}h`);
    return;
  }

  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = join(BACKUP_DIR, `tracker-${date}.db`);

    // VACUUM INTO cria um backup compactado e consistente
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    setLastBackup(new Date());
    cleanOldBackups();
    logger.info("backup", `backup criado: ${backupPath}`);
  } catch (err) {
    logger.error("backup", `falha no backup: ${err}`);
  }
}
