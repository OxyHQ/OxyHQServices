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
 * Returns the MongoDB database name for the current environment.
 * Convention: "{appName}-{envSuffix}" — e.g. "oxy-prod", "oxy-dev".
 */
export function getDbName(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const envSuffix = ENV_DB_MAP[nodeEnv] || nodeEnv;
  return `${APP_NAME}-${envSuffix}`;
}
