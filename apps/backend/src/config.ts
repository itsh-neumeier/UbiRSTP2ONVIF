import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().min(1).default(join(process.cwd(), ".data")),
  APP_BASE_URL: z.string().url().optional(),
  APP_VERSION: z.string().default("0.1.0"),
  COOKIE_NAME: z.string().min(1).default("ubirstp2onvif.sid"),
  COOKIE_SECURE: z.coerce.boolean().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  HEALTHCHECK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ONVIF_DISCOVERY_ENABLED: z.coerce.boolean().default(true),
  ONVIF_DISCOVERY_PORT: z.coerce.number().int().positive().default(3702),
  GITHUB_URL: z.string().url().default("https://github.com/example/UbiRSTP2ONVIF")
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
  const dataDir = parsed.DATA_DIR;
  const secrets = ensureInstanceSecrets(dataDir);
  const baseUrl = parsed.APP_BASE_URL ?? `http://localhost:${parsed.PORT}`;

  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    dataDir,
    dbPath: join(dataDir, "ubirstp2onvif.sqlite"),
    baseUrl,
    version: parsed.APP_VERSION,
    githubUrl: parsed.GITHUB_URL,
    cookieName: parsed.COOKIE_NAME,
    cookieSecure:
      parsed.COOKIE_SECURE ?? baseUrl.startsWith("https://") || parsed.NODE_ENV === "production",
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
