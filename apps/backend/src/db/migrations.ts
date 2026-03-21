export type Migration = {
  id: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
        locale TEXT NOT NULL DEFAULT 'en',
        password_hash TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        user_agent TEXT,
        remote_addr TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS streams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        rtsp_url TEXT NOT NULL,
        username_enc TEXT,
        password_enc TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        last_status TEXT NOT NULL DEFAULT 'unknown',
        last_error TEXT,
        last_check_at TEXT,
        onvif_name TEXT,
        onvif_manufacturer TEXT,
        onvif_model TEXT,
        onvif_hardware_id TEXT,
        onvif_firmware_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    id: "002_add_stream_diagnostics",
    sql: `
      ALTER TABLE streams ADD COLUMN last_latency_ms INTEGER;
      ALTER TABLE streams ADD COLUMN recorder_notes TEXT NOT NULL DEFAULT '';
    `
  }
];
