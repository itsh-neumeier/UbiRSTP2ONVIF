import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";

import type { AppConfig } from "../config.js";
import { migrations } from "./migrations.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";

export type DbHandle = Database.Database;

export type UserRole = "admin" | "viewer";

export type UserRecord = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  locale: "en" | "de";
  disabled: number;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

export type SessionRecord = {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string | null;
  remote_addr: string | null;
};

export type StreamRecord = {
  id: string;
  name: string;
  description: string;
  rtsp_url: string;
  username_enc: string | null;
  password_enc: string | null;
  active: number;
  last_status: "healthy" | "error" | "unknown";
  last_error: string | null;
  last_check_at: string | null;
  last_latency_ms: number | null;
  recorder_notes: string;
  onvif_name: string | null;
  onvif_manufacturer: string | null;
  onvif_model: string | null;
  onvif_hardware_id: string | null;
  onvif_firmware_version: string | null;
  created_at: string;
  updated_at: string;
};

export function createDatabase(config: AppConfig): DbHandle {
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

function applyMigrations(db: DbHandle): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    const tx = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, new Date().toISOString());
    });
    tx();
  }
}

export function ensureDefaultAdmin(db: DbHandle, config: AppConfig, logger: { warn: (message: string) => void }): Promise<void> {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (count.count > 0) {
    return Promise.resolve();
  }

  const generatedPassword = config.adminPassword ?? randomUUID().replaceAll("-", "");
  if (!config.adminPassword) {
    logger.warn(`Generated initial admin password for ${config.adminUsername}: ${generatedPassword}`);
  }

  return createUser(db, {
    username: config.adminUsername,
    displayName: "Administrator",
    password: generatedPassword,
    role: "admin",
    locale: "en"
  }).then(() => undefined);
}

export async function createUser(
  db: DbHandle,
  input: {
    username: string;
    displayName: string;
    password: string;
    role: UserRole;
    locale: "en" | "de";
  }
): Promise<UserRecord> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  db.prepare(
    `
      INSERT INTO users (id, username, display_name, role, locale, password_hash, disabled, created_at, updated_at)
      VALUES (@id, @username, @display_name, @role, @locale, @password_hash, 0, @created_at, @updated_at)
    `
  ).run({
    id,
    username: input.username,
    display_name: input.displayName,
    role: input.role,
    locale: input.locale,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now
  });

  return getUserById(db, id)!;
}

export function listUsers(db: DbHandle): UserRecord[] {
  return db.prepare("SELECT * FROM users ORDER BY username ASC").all() as UserRecord[];
}

export function getUserByUsername(db: DbHandle, username: string): UserRecord | null {
  return (db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRecord | undefined) ?? null;
}

export function getUserById(db: DbHandle, id: string): UserRecord | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined) ?? null;
}

export async function verifyUserPassword(user: UserRecord, password: string): Promise<boolean> {
  return argon2.verify(user.password_hash, password);
}

export async function resetUserPassword(db: DbHandle, userId: string, password: string): Promise<void> {
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, new Date().toISOString(), userId);
}

export function updateUser(
  db: DbHandle,
  userId: string,
  patch: Partial<Pick<UserRecord, "display_name" | "role" | "locale" | "disabled">>
): UserRecord | null {
  const current = getUserById(db, userId);
  if (!current) {
    return null;
  }

  db.prepare(
    `
      UPDATE users
      SET display_name = ?, role = ?, locale = ?, disabled = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(
    patch.display_name ?? current.display_name,
    patch.role ?? current.role,
    patch.locale ?? current.locale,
    patch.disabled ?? current.disabled,
    new Date().toISOString(),
    userId
  );

  return getUserById(db, userId);
}

export function createSession(
  db: DbHandle,
  input: { userId: string; expiresAt: string; userAgent?: string; remoteAddr?: string }
): SessionRecord {
  const session: SessionRecord = {
    id: randomUUID(),
    user_id: input.userId,
    expires_at: input.expiresAt,
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    user_agent: input.userAgent ?? null,
    remote_addr: input.remoteAddr ?? null
  };
  db.prepare(
    `
      INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at, user_agent, remote_addr)
      VALUES (@id, @user_id, @expires_at, @created_at, @last_seen_at, @user_agent, @remote_addr)
    `
  ).run(session);
  return session;
}

export function getSession(db: DbHandle, sessionId: string): SessionRecord | null {
  return (db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRecord | undefined) ?? null;
}

export function touchSession(db: DbHandle, sessionId: string): void {
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), sessionId);
}

export function deleteSession(db: DbHandle, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function deleteUserSessions(db: DbHandle, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export type StreamInput = {
  name: string;
  description?: string;
  rtspUrl: string;
  username?: string | null;
  password?: string | null;
  active: boolean;
  recorderNotes?: string;
  onvifName?: string | null;
  onvifManufacturer?: string | null;
  onvifModel?: string | null;
  onvifHardwareId?: string | null;
  onvifFirmwareVersion?: string | null;
};

export function listStreams(db: DbHandle): StreamRecord[] {
  return db.prepare("SELECT * FROM streams ORDER BY created_at DESC").all() as StreamRecord[];
}

export function getStreamById(db: DbHandle, id: string): StreamRecord | null {
  return (db.prepare("SELECT * FROM streams WHERE id = ?").get(id) as StreamRecord | undefined) ?? null;
}

export function createStream(db: DbHandle, config: AppConfig, input: StreamInput): StreamRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO streams (
        id, name, description, rtsp_url, username_enc, password_enc, active,
        last_status, last_error, last_check_at, last_latency_ms, recorder_notes,
        onvif_name, onvif_manufacturer, onvif_model, onvif_hardware_id, onvif_firmware_version, created_at, updated_at
      )
      VALUES (
        @id, @name, @description, @rtsp_url, @username_enc, @password_enc, @active,
        'unknown', NULL, NULL, NULL, @recorder_notes, @onvif_name, @onvif_manufacturer,
        @onvif_model, @onvif_hardware_id, @onvif_firmware_version, @created_at, @updated_at
      )
    `
  ).run({
    id,
    name: input.name,
    description: input.description ?? "",
    rtsp_url: input.rtspUrl,
    username_enc: input.username ? encryptSecret(config.encryptionKey, input.username) : null,
    password_enc: input.password ? encryptSecret(config.encryptionKey, input.password) : null,
    active: input.active ? 1 : 0,
    recorder_notes: input.recorderNotes ?? "",
    onvif_name: input.onvifName ?? null,
    onvif_manufacturer: input.onvifManufacturer ?? null,
    onvif_model: input.onvifModel ?? null,
    onvif_hardware_id: input.onvifHardwareId ?? null,
    onvif_firmware_version: input.onvifFirmwareVersion ?? null,
    created_at: now,
    updated_at: now
  });
  return getStreamById(db, id)!;
}

export function updateStream(db: DbHandle, config: AppConfig, id: string, input: Partial<StreamInput>): StreamRecord | null {
  const current = getStreamById(db, id);
  if (!current) {
    return null;
  }
  const now = new Date().toISOString();

  db.prepare(
    `
      UPDATE streams SET
        name = ?,
        description = ?,
        rtsp_url = ?,
        username_enc = ?,
        password_enc = ?,
        active = ?,
        recorder_notes = ?,
        onvif_name = ?,
        onvif_manufacturer = ?,
        onvif_model = ?,
        onvif_hardware_id = ?,
        onvif_firmware_version = ?,
        updated_at = ?
      WHERE id = ?
    `
  ).run(
    input.name ?? current.name,
    input.description ?? current.description,
    input.rtspUrl ?? current.rtsp_url,
    input.username === undefined
      ? current.username_enc
      : input.username
        ? encryptSecret(config.encryptionKey, input.username)
        : null,
    input.password === undefined
      ? current.password_enc
      : input.password
        ? encryptSecret(config.encryptionKey, input.password)
        : null,
    input.active === undefined ? current.active : input.active ? 1 : 0,
    input.recorderNotes ?? current.recorder_notes,
    input.onvifName ?? current.onvif_name,
    input.onvifManufacturer ?? current.onvif_manufacturer,
    input.onvifModel ?? current.onvif_model,
    input.onvifHardwareId ?? current.onvif_hardware_id,
    input.onvifFirmwareVersion ?? current.onvif_firmware_version,
    now,
    id
  );
  return getStreamById(db, id);
}

export function deleteStream(db: DbHandle, id: string): boolean {
  const result = db.prepare("DELETE FROM streams WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateStreamHealth(
  db: DbHandle,
  id: string,
  patch: { status: "healthy" | "error" | "unknown"; error?: string | null; checkedAt: string; latencyMs?: number | null }
): void {
  db.prepare(
    `
      UPDATE streams
      SET last_status = ?, last_error = ?, last_check_at = ?, last_latency_ms = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(patch.status, patch.error ?? null, patch.checkedAt, patch.latencyMs ?? null, patch.checkedAt, id);
}

export function getStreamCredentials(
  stream: StreamRecord,
  config: AppConfig
): { username: string | null; password: string | null } {
  return {
    username: stream.username_enc ? decryptSecret(config.encryptionKey, stream.username_enc) : null,
    password: stream.password_enc ? decryptSecret(config.encryptionKey, stream.password_enc) : null
  };
}
