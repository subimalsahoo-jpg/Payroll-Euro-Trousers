'use strict';

/**
 * System backup service (Module 15).
 * -------------------------------------------------------------
 * Triggers a logical MySQL dump using mysqldump into the configured
 * backup directory. Returns metadata about the created archive. The
 * command is parameterised via env config; credentials are passed via
 * a transient defaults-extra-file to avoid leaking the password in the
 * process list.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const env = require('../config/env');
const logger = require('../utils/logger');

/** Run an administrative database backup. Resolves with { file, bytes }. */
function runBackup() {
  return new Promise((resolve, reject) => {
    const dir = path.resolve(env.storage.backupDir);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${env.db.database}_${stamp}.sql`);

    // Write a temporary defaults file so the password never appears in argv.
    const cnf = path.join(os.tmpdir(), `dm_backup_${Date.now()}.cnf`);
    fs.writeFileSync(
      cnf,
      `[client]\nuser=${env.db.user}\npassword=${env.db.password}\nhost=${env.db.host}\nport=${env.db.port}\n`,
      { mode: 0o600 }
    );

    const out = fs.createWriteStream(file);
    const proc = spawn('mysqldump', [`--defaults-extra-file=${cnf}`, '--single-transaction', '--routines', env.db.database]);

    proc.stdout.pipe(out);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      fs.existsSync(cnf) && fs.unlinkSync(cnf);
      logger.error('mysqldump spawn failed', err.message);
      reject(new Error('Backup tool (mysqldump) is not available on this host'));
    });

    proc.on('close', (code) => {
      if (fs.existsSync(cnf)) fs.unlinkSync(cnf);
      out.end();
      if (code !== 0) {
        logger.error('mysqldump failed', stderr);
        return reject(new Error(`Backup failed (exit ${code})`));
      }
      const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
      logger.info(`Backup created: ${file} (${bytes} bytes)`);
      return resolve({ file, bytes });
    });
  });
}

/** List existing backup archives. */
function listBackups() {
  const dir = path.resolve(env.storage.backupDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, bytes: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

module.exports = { runBackup, listBackups };
