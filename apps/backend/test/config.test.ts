import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const cleanupPaths: string[] = [];

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createTempDataDir() {
  const dataDir = mkdtempSync(join(tmpdir(), "ubirstp2onvif-config-"));
  cleanupPaths.push(dataDir);
  return dataDir;
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

describe("loadConfig", () => {
  it("does not force secure cookies on plain HTTP by default", () => {
    withEnv(
      {
        DATA_DIR: createTempDataDir(),
        APP_BASE_URL: "http://192.168.140.30:8080",
        COOKIE_SECURE: undefined
      },
      () => {
        const config = loadConfig();
        expect(config.cookieSecure).toBe(false);
      }
    );
  });

  it("parses explicit false boolean env values correctly", () => {
    withEnv(
      {
        DATA_DIR: createTempDataDir(),
        APP_BASE_URL: "http://192.168.140.30:8080",
        COOKIE_SECURE: "false",
        ONVIF_DISCOVERY_ENABLED: "false"
      },
      () => {
        const config = loadConfig();
        expect(config.cookieSecure).toBe(false);
        expect(config.onvifDiscoveryEnabled).toBe(false);
      }
    );
  });

  it("requires a worker stream id when running in worker mode", () => {
    withEnv(
      {
        DATA_DIR: createTempDataDir(),
        APP_ROLE: "worker",
        WORKER_STREAM_ID: undefined
      },
      () => {
        expect(() => loadConfig()).toThrow("WORKER_STREAM_ID is required when APP_ROLE=worker.");
      }
    );
  });
});
