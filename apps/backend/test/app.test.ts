import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const cleanupPaths: string[] = [];

async function createTestApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "ubirstp2onvif-"));
  cleanupPaths.push(dataDir);

  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = dataDir;
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "AdminPassword123!";
  process.env.APP_BASE_URL = "http://localhost:8080";
  process.env.ONVIF_DISCOVERY_ENABLED = "false";

  return buildApp();
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

describe("backend application", () => {
  it("creates the default admin and allows session login", async () => {
    const app = await createTestApp();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "AdminPassword123!"
      }
    });

    expect(login.statusCode).toBe(200);
    const cookie = login.cookies[0]?.value;
    expect(cookie).toBeTruthy();

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: {
        [app.config.cookieName]: cookie
      }
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("admin");

    await app.close();
  });

  it("allows an admin to create a viewer user", async () => {
    const app = await createTestApp();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "AdminPassword123!"
      }
    });

    const cookie = login.cookies[0]?.value;
    const createUser = await app.inject({
      method: "POST",
      url: "/api/users",
      cookies: {
        [app.config.cookieName]: cookie
      },
      payload: {
        username: "viewer.one",
        displayName: "Viewer One",
        password: "ViewerPassword123!",
        role: "viewer",
        locale: "de"
      }
    });

    expect(createUser.statusCode).toBe(201);
    expect(createUser.json().user.username).toBe("viewer.one");

    await app.close();
  });

  it("returns a usable ONVIF stream URI response", async () => {
    const app = await createTestApp();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "AdminPassword123!"
      }
    });

    const cookie = login.cookies[0]?.value;
    const created = await app.inject({
      method: "POST",
      url: "/api/streams",
      cookies: {
        [app.config.cookieName]: cookie
      },
      payload: {
        name: "Garage",
        description: "Test stream",
        rtspUrl: "rtsp://camera.example.com/live",
        username: "camuser",
        password: "campass",
        active: true
      }
    });

    const streamId = created.json().stream.id as string;
    const soap = await app.inject({
      method: "POST",
      url: `/onvif/${streamId}/media_service`,
      headers: {
        "content-type": "application/soap+xml"
      },
      payload:
        '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl" /></s:Body></s:Envelope>'
    });

    expect(soap.statusCode).toBe(200);
    expect(soap.body).toContain("rtsp://camuser:campass@camera.example.com/live");

    await app.close();
  });
});
