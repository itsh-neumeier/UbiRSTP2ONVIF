import { describe, expect, it } from "vitest";

import { validateRtspUrl } from "../src/lib/rtsp.js";

describe("validateRtspUrl", () => {
  it("accepts a regular LAN camera target", () => {
    const result = validateRtspUrl("rtsp://192.168.1.40:554/live");
    expect(result.sanitizedUrl).toContain("192.168.1.40");
    expect(result.sanitizedUrl).toContain("/live");
  });

  it("rejects loopback targets", () => {
    expect(() => validateRtspUrl("rtsp://127.0.0.1/live")).toThrow(/not allowed/i);
  });

  it("rejects embedded credentials", () => {
    expect(() => validateRtspUrl("rtsp://user:pass@camera.example.com/live")).toThrow(/credentials separately/i);
  });
});
