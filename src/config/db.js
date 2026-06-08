'use strict';

/**
 * MySQL 8 connection pool + transaction helpers.
 * -------------------------------------------------------------
 * Uses mysql2/promise for async/await and parameterised queries.
 * All SQL in the application flows through these helpers so that:
 *   - statements are always parameterised (anti SQL-injection),
 *   - ACID transactions are easy to compose,
 *   - the pool is shared and cluster-friendly (stateless workers).
 */

const mysql = require('mysql2/promise');
const env = require('./env');
const logger = require('../utils/logger');

let pool;

/** Lazily create (or return) the shared connection pool. */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      waitForConnections: true,
      connectionLimit: env.db.connectionLimit,
      maxIdle: env.db.connectionLimit,
      idleTimeout: 60000,
      queueLimit: 0,
      timezone: env.db.timezone,
      decimalNumbers: false, // keep DECIMAL as strings for precise money math
      namedPlaceholders: true,
      charset: 'utf8mb4',
    });
    logger.info(`MySQL pool created for ${env.db.host}:${env.db.port}/${env.db.database}`);
  }
  return pool;
}

/**
 * Execute a parameterised query and return the rows.
 * @param {string} sql - SQL with `?` or `:named` placeholders.
 * @param {Array|Object} [params] - Bound parameters.
 * @returns {Promise<Array>} rows
 */
async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/**
 * Execute a query expecting a single row (or null).
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * Run a set of statements inside a single ACID transaction.
 * The callback receives a bound `tx` helper exposing query/queryOne
 * on the same connection. Automatically commits on success and
 * rolls back on any thrown error.
 *
 * @param {(tx: {query: Function, queryOne: Function, connection: object}) => Promise<any>} work
 * @returns {Promise<any>} the value returned by `work`
 */
async function transaction(work) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const tx = {
      connection: conn,
      query: async (sql, params = []) => {
        const [rows] = await conn.execute(sql, params);
        return rows;
      },
      queryOne: async (sql, params = []) => {
        const [rows] = await conn.execute(sql, params);
        return rows.length ? rows[0] : null;
      },
    };

    const result = await work(tx);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      logger.error('Transaction rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Verify connectivity at boot. Throws if the DB is unreachable. */
async function healthCheck() {
  const row = await queryOne('SELECT 1 AS ok');
  return row && row.ok === 1;
}

/** Gracefully close the pool (used on shutdown). */
async function close() {
  if (pool) {
    await pool.end();
    pool = undefined;
    logger.info('MySQL pool closed');
  }
}

module.exports = {
  getPool,
  query,
  queryOne,
  transaction,
  healthCheck,
  close,
};
