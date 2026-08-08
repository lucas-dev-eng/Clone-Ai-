import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import * as schema from './schema.ts';

const { Pool } = pkg;

// Add global connection pool caching to persist across hot-reloads
declare global {
  var _postgresPool: pkg.Pool | undefined;
}

// Function to create or retrieve the connection pool.
export const createPool = () => {
  if (!global._postgresPool) {
    const host = process.env.SQL_HOST;
    const user = process.env.SQL_USER;
    const password = process.env.SQL_PASSWORD;
    const database = process.env.SQL_DB_NAME;

    if (!host || !user || !password || !database) {
      console.warn("[Database] Missing runtime environment variables (SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME). Connection will be lazy.");
    }

    global._postgresPool = new Pool({
      host,
      user,
      password,
      database,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    // Prevent unhandled pool-level errors from crashing the application
    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

// Create or retrieve the pool instance.
const pool = createPool();

// Initialize Drizzle with the pool and schema.
export const db = drizzle(pool, { schema });
export * as schema from './schema.ts';
