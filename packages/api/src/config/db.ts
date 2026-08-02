/**
 * Database Configuration
 *
 * Centralizes the database naming convention so that every entry point
 * (main server, email worker, future workers) uses the same DB name.
 */

const APP_NAME = 'oxy';

const ENV_DB_MAP: Record<string, string> = {
  production: 'prod',
  development: 'dev',
};

/**
 * Returns the legacy MongoDB database name for the current environment.
 * Used only by backfill and one-shot admin scripts — the serving API uses
 * Postgres (`DATABASE_URL`). Convention: "{appName}-{envSuffix}".
 */
export function getDbName(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envSuffix = ENV_DB_MAP[nodeEnv] || nodeEnv;
  return `${APP_NAME}-${envSuffix}`;
}
