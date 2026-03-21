import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const envBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    throw new Error(`Invalid boolean value: ${value}`);
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ROLE: z.enum(["control-plane", "worker"]).default("control-plane"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().min(1).default(join(process.cwd(), ".data")),
  APP_BASE_URL: z.string().url().optional(),
  APP_VERSION: z.string().default("0.2.1"),
  WORKER_STREAM_ID: z.string().min(1).optional(),
  GO2RTC_RTSP_PORT: z.coerce.number().int().positive().default(8554),
  GO2RTC_API_PORT: z.coerce.number().int().positive().default(1984),
  GO2RTC_STREAM_NAME: z.string().min(1).default("camera"),
  ONVIF_USERNAME: z.string().min(1).default("admin"),
  ONVIF_PASSWORD: z.string().min(1).optional(),
  COOKIE_NAME: z.string().min(1).default("ubirstp2onvif.sid"),
  COOKIE_SECURE: envBoolean,
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  HEALTHCHECK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ONVIF_DISCOVERY_ENABLED: envBoolean.default(true),
  ONVIF_DISCOVERY_PORT: z.coerce.number().int().positive().default(3702),
  GITHUB_URL: z.string().url().default("https://github.com/itsh-neumeier/UbiRSTP2ONVIF")
});

type InstanceSecrets = {
  encryptionKey: string;
  cookieSecret: string;
  generatedAdminPassword?: string;
};

function ensureDataDir(dataDir: string): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function ensureInstanceSecrets(dataDir: string): InstanceSecrets {
  ensureDataDir(dataDir);
  const secretsPath = join(dataDir, "instance-secrets.json");
  if (existsSync(secretsPath)) {
    return JSON.parse(readFileSync(secretsPath, "utf8")) as InstanceSecrets;
  }

  const secrets: InstanceSecrets = {
    encryptionKey: randomBytes(32).toString("base64"),
    cookieSecret: randomBytes(32).toString("base64")
  };
  writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), "utf8");
  return secrets;
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = envSchema.parse(process.env);
  if (parsed.APP_ROLE === "worker" && !parsed.WORKER_STREAM_ID) {
    throw new Error("WORKER_STREAM_ID is required when APP_ROLE=worker.");
  }
  const dataDir = parsed.DATA_DIR;
  const secrets = ensureInstanceSecrets(dataDir);
  const baseUrl = parsed.APP_BASE_URL ?? `http://localhost:${parsed.PORT}`;

  return {
    env: parsed.NODE_ENV,
    appRole: parsed.APP_ROLE,
    port: parsed.PORT,
    dataDir,
    dbPath: join(dataDir, "ubirstp2onvif.sqlite"),
    baseUrl,
    version: parsed.APP_VERSION,
    workerStreamId: parsed.WORKER_STREAM_ID ?? null,
    go2rtcRtspPort: parsed.GO2RTC_RTSP_PORT,
    go2rtcApiPort: parsed.GO2RTC_API_PORT,
    go2rtcStreamName: parsed.GO2RTC_STREAM_NAME,
    onvifUsername: parsed.ONVIF_USERNAME,
    onvifPassword: parsed.ONVIF_PASSWORD ?? null,
    githubUrl: parsed.GITHUB_URL,
    cookieName: parsed.COOKIE_NAME,
    cookieSecure: parsed.COOKIE_SECURE ?? baseUrl.startsWith("https://"),
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    healthcheckIntervalSeconds: parsed.HEALTHCHECK_INTERVAL_SECONDS,
    adminUsername: parsed.ADMIN_USERNAME,
    adminPassword: parsed.ADMIN_PASSWORD,
    onvifDiscoveryEnabled: parsed.ONVIF_DISCOVERY_ENABLED,
    onvifDiscoveryPort: parsed.ONVIF_DISCOVERY_PORT,
    encryptionKey: secrets.encryptionKey,
    cookieSecret: secrets.cookieSecret
  };
}
