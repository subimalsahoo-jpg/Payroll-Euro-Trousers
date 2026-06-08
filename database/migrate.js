'use strict';

/**
 * Lightweight migration & seed runner.
 * -------------------------------------------------------------
 * Usage:
 *   node database/migrate.js up      # apply pending migrations
 *   node database/migrate.js fresh   # drop DB, recreate, apply all migrations
 *   node database/migrate.js seed    # load seed data + create default users
 *
 * Designed for environments without a heavyweight ORM. Uses a dedicated
 * connection with multipleStatements enabled (migrations only). User
 * password hashes are generated here with bcrypt so the SQL seed never
 * contains plaintext or hardcoded hashes.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SEEDS_DIR = path.join(__dirname, 'seeds');

/** Open a raw connection (optionally without selecting a database). */
async function connect({ withDb = true } = {}) {
  return mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: withDb ? env.db.database : undefined,
    multipleStatements: true,
    timezone: env.db.timezone,
  });
}

async function ensureDatabase() {
  const conn = await connect({ withDb: false });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();
  console.log(`[migrate] database "${env.db.database}" ready`);
}

async function dropDatabase() {
  const conn = await connect({ withDb: false });
  await conn.query(`DROP DATABASE IF EXISTS \`${env.db.database}\``);
  await conn.end();
  console.log(`[migrate] database "${env.db.database}" dropped`);
}

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function appliedSet(conn) {
  try {
    const [rows] = await conn.query('SELECT filename FROM schema_migrations');
    return new Set(rows.map((r) => r.filename));
  } catch (_e) {
    return new Set(); // schema_migrations not created yet
  }
}

async function up() {
  await ensureDatabase();
  const conn = await connect();
  try {
    const applied = await appliedSet(conn);
    for (const file of migrationFiles()) {
      if (applied.has(file)) {
        console.log(`[migrate] skip ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] applying ${file} ...`);
      await conn.query(sql);
      await conn.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`[migrate] applied ${file}`);
    }
    console.log('[migrate] up complete');
  } finally {
    await conn.end();
  }
}

async function fresh() {
  await dropDatabase();
  await up();
}

/** Default accounts created at seed time (password hashed with bcrypt). */
function defaultUsers() {
  return [
    { company_id: 1, branch_id: 1, role_id: 1, employee_id: null, username: 'superadmin',  email: 'superadmin@euro-trousers.example', full_name: 'System Super Admin' },
    { company_id: 1, branch_id: 1, role_id: 2, employee_id: 2,    username: 'hr.manager',  email: 'divya.moolya@euro-trousers.example', full_name: 'Divya Moolya' },
    { company_id: 1, branch_id: 1, role_id: 3, employee_id: 4,    username: 'payroll',     email: 'mariam.hassan@euro-trousers.example', full_name: 'Mariam Hassan' },
    { company_id: 1, branch_id: 2, role_id: 4, employee_id: 5,    username: 'manager.imran', email: 'imran.khan@euro-trousers.example', full_name: 'Imran Khan' },
    { company_id: 1, branch_id: 2, role_id: 5, employee_id: 6,    username: 'arun.kumar',  email: 'arun.kumar@euro-trousers.example', full_name: 'Arun Kumar' },
  ];
}

async function seed() {
  const conn = await connect();
  try {
    // 1) Load reference + mock data SQL.
    const seedSql = fs.readFileSync(path.join(SEEDS_DIR, 'seed.sql'), 'utf8');
    console.log('[seed] loading seed.sql ...');
    await conn.query(seedSql);

    // 2) Create default user accounts with bcrypt-hashed passwords.
    const password = process.env.SEED_DEFAULT_PASSWORD || 'Admin@123';
    const hash = await bcrypt.hash(password, env.security.bcryptRounds);

    for (const u of defaultUsers()) {
      await conn.query(
        `INSERT INTO users
           (company_id, branch_id, role_id, employee_id, username, email, password_hash, full_name, is_active, preferred_locale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'en')
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name)`,
        [u.company_id, u.branch_id, u.role_id, u.employee_id, u.username, u.email, hash, u.full_name]
      );
      console.log(`[seed] user "${u.username}" ready`);
    }

    console.log('\n[seed] complete. Default login password:', password);
    console.log('[seed] Try: superadmin / hr.manager / payroll / manager.imran / arun.kumar');
  } finally {
    await conn.end();
  }
}

async function main() {
  const cmd = process.argv[2] || 'up';
  try {
    if (cmd === 'up') await up();
    else if (cmd === 'fresh') await fresh();
    else if (cmd === 'seed') await seed();
    else {
      console.error(`Unknown command "${cmd}". Use: up | fresh | seed`);
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error('[migrate] ERROR:', err.message);
    process.exit(1);
  }
}

main();
