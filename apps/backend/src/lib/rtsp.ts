import net from "node:net";

export type RtspValidationResult = {
  url: URL;
  sanitizedUrl: string;
};

const blockedHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isBlockedIp(host: string): boolean {
  const version = net.isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a >= 224
    );
  }

  if (version === 6) {
    const normalized = host.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("ff")
    );
  }

  return false;
}

export function validateRtspUrl(input: string): RtspValidationResult {
  const url = new URL(input);
  if (!["rtsp:", "rtsps:"].includes(url.protocol)) {
    throw new Error("Only RTSP and RTSPS URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("Embed credentials separately instead of placing them in the RTSP URL.");
  }
  if (blockedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Loopback and localhost RTSP targets are not allowed.");
  }
  if (isBlockedIp(url.hostname)) {
    throw new Error("Loopback, link-local, multicast, and unspecified RTSP targets are not allowed.");
  }
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("The RTSP port must be within the valid TCP port range.");
    }
  }

  const sanitized = new URL(url.toString());
  sanitized.username = "";
  sanitized.password = "";
  return {
    url,
    sanitizedUrl: sanitized.toString()
  };
}

export function buildRtspPlaybackUrl(
  rtspUrl: string,
  credentials: { username: string | null; password: string | null }
): string {
  const url = new URL(rtspUrl);
  if (credentials.username) {
    url.username = credentials.username;
  }
  if (credentials.password) {
    url.password = credentials.password;
  }
  return url.toString();
}

export async function testRtspConnectivity(rtspUrl: string, timeoutMs = 4000): Promise<{ latencyMs: number; responseLine: string }> {
  const url = new URL(rtspUrl);
  const port = url.port ? Number(url.port) : url.protocol === "rtsps:" ? 322 : 554;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("RTSP connection timed out."));
    }, timeoutMs);

    socket.on("connect", () => {
      const request = `OPTIONS ${url.toString()} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: UbiRSTP2ONVIF\r\n\r\n`;
      socket.write(request);
    });

    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n")) {
        clearTimeout(timer);
        socket.end();
        resolve({
          latencyMs: Date.now() - start,
          responseLine: response.split("\r\n")[0] ?? "RTSP response received"
        });
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
