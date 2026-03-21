import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const cleanupPaths: string[] = [];

async function createTestApp(overrides: Record<string, string> = {}, dataDir?: string) {
  const resolvedDataDir = dataDir ?? mkdtempSync(join(tmpdir(), "ubirstp2onvif-"));
  if (!dataDir) {
    cleanupPaths.push(resolvedDataDir);
  }

  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = resolvedDataDir;
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "AdminPassword123!";
  process.env.APP_BASE_URL = "http://localhost:8080";
  process.env.ONVIF_DISCOVERY_ENABLED = "false";
  delete process.env.APP_ROLE;
  delete process.env.WORKER_STREAM_ID;
  delete process.env.GO2RTC_RTSP_PORT;
  delete process.env.GO2RTC_API_PORT;
  delete process.env.GO2RTC_STREAM_NAME;
  delete process.env.ONVIF_USERNAME;
  delete process.env.ONVIF_PASSWORD;

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

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

  it("stores worker deployment fields and exposes a compose preview", async () => {
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
        name: "Driveway",
        description: "Worker test",
        rtspUrl: "rtsp://camera.example.com/live",
        active: true,
        workerMode: "dedicated",
        advertisedHost: "192.168.10.50",
        workerHttpPort: 8081,
        workerNetworkName: "ubirstp2onvif-camera",
        go2rtcMode: "ffmpeg",
        go2rtcVideo: "h264",
        go2rtcAudio: "aac",
        go2rtcRaw: "-i /config/mask.png -filter_complex [0:v]avgblur=25[v] -map [v]"
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().stream.worker.mode).toBe("dedicated");
    expect(created.json().stream.worker.advertisedHost).toBe("192.168.10.50");

    const streamId = created.json().stream.id as string;
    const compose = await app.inject({
      method: "GET",
      url: `/api/streams/${streamId}/compose`,
      cookies: {
        [app.config.cookieName]: cookie
      }
    });

    expect(compose.statusCode).toBe(200);
    expect(compose.json().deployment.requiresDedicatedIp).toBe(true);
    expect(compose.json().deployment.adoptUrl).toBe("http://192.168.10.50:8081/onvif/device_service");
    expect(compose.json().deployment.notes).toContain("Use a dedicated LAN IP per worker.");
    expect(compose.json().deployment.go2rtc.mode).toBe("ffmpeg");
    expect(compose.json().deployment.go2rtcConfig).toContain("ffmpeg:rtsp://camera.example.com/live#video=h264#audio=aac#raw=-i /config/mask.png -filter_complex [0:v]avgblur=25[v] -map [v]");
    expect(compose.json().deployment.composeYaml).toContain("network_mode: 'service:camera-driveway'");
    expect(compose.json().deployment.composeYaml).toContain("image: 'alexxit/go2rtc:latest'");

    await app.close();
  });

  it("serves worker-style root ONVIF endpoints and go2rtc RTSP URIs", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ubirstp2onvif-worker-"));
    cleanupPaths.push(dataDir);

    const controlPlane = await createTestApp({}, dataDir);
    const login = await controlPlane.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "AdminPassword123!"
      }
    });

    const cookie = login.cookies[0]?.value;
    const created = await controlPlane.inject({
      method: "POST",
      url: "/api/streams",
      cookies: {
        [controlPlane.config.cookieName]: cookie
      },
      payload: {
        name: "Garden",
        description: "Worker root route",
        rtspUrl: "rtsp://camera.example.com/garden",
        active: true,
        workerMode: "dedicated",
        advertisedHost: "192.168.10.60"
      }
    });

    const streamId = created.json().stream.id as string;
    await controlPlane.close();

    const worker = await createTestApp(
      {
        APP_ROLE: "worker",
        WORKER_STREAM_ID: streamId,
        APP_BASE_URL: "http://192.168.10.60:8080",
        GO2RTC_RTSP_PORT: "8554",
        GO2RTC_STREAM_NAME: "camera"
      },
      dataDir
    );

    const soap = await worker.inject({
      method: "POST",
      url: "/onvif/media_service",
      headers: {
        "content-type": "application/soap+xml"
      },
      payload:
        '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl" /></s:Body></s:Envelope>'
    });

    expect(soap.statusCode).toBe(200);
    expect(soap.body).toContain("rtsp://192.168.10.60:8554/camera");

    const deviceInfo = await worker.inject({
      method: "POST",
      url: "/onvif/device_service",
      headers: {
        "content-type": "application/soap+xml"
      },
      payload:
        '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><tds:GetServices xmlns:tds="http://www.onvif.org/ver10/device/wsdl" /></s:Body></s:Envelope>'
    });

    expect(deviceInfo.statusCode).toBe(200);
    expect(deviceInfo.body).toContain("http://192.168.10.60:8080/onvif/device_service");
    expect(deviceInfo.body).toContain("http://192.168.10.60:8080/onvif/media_service");

    await worker.close();
  });

  it("requires ONVIF basic auth when ONVIF_PASSWORD is configured", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ubirstp2onvif-worker-auth-"));
    cleanupPaths.push(dataDir);

    const controlPlane = await createTestApp({}, dataDir);
    const login = await controlPlane.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "admin",
        password: "AdminPassword123!"
      }
    });

    const cookie = login.cookies[0]?.value;
    const created = await controlPlane.inject({
      method: "POST",
      url: "/api/streams",
      cookies: {
        [controlPlane.config.cookieName]: cookie
      },
      payload: {
        name: "Frontdoor",
        description: "Worker auth route",
        rtspUrl: "rtsp://camera.example.com/frontdoor",
        active: true,
        workerMode: "dedicated",
        advertisedHost: "192.168.10.61"
      }
    });

    const streamId = created.json().stream.id as string;
    await controlPlane.close();

    const worker = await createTestApp(
      {
        APP_ROLE: "worker",
        WORKER_STREAM_ID: streamId,
        APP_BASE_URL: "http://192.168.10.61:8080",
        ONVIF_USERNAME: "onvif",
        ONVIF_PASSWORD: "ProtectPass123!"
      },
      dataDir
    );

    const unauthorized = await worker.inject({
      method: "POST",
      url: "/onvif/device_service",
      headers: {
        "content-type": "application/soap+xml"
      },
      payload:
        '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl" /></s:Body></s:Envelope>'
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain("Basic");

    const authHeader = `Basic ${Buffer.from("onvif:ProtectPass123!", "utf8").toString("base64")}`;
    const authorized = await worker.inject({
      method: "POST",
      url: "/onvif/device_service",
      headers: {
        "content-type": "application/soap+xml",
        authorization: authHeader
      },
      payload:
        '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl" /></s:Body></s:Envelope>'
    });

    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).toContain("GetDeviceInformationResponse");

    await worker.close();
  });
});
