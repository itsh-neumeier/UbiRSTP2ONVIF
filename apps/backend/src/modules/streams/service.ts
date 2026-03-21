import type { FastifyBaseLogger } from "fastify";

import type { AppConfig } from "../../config.js";
import {
  createStream,
  getStreamById,
  getStreamCredentials,
  listStreams,
  updateStream,
  updateStreamHealth,
  type DbHandle,
  type StreamInput,
  type StreamRecord,
  type WorkerMode
} from "../../db/database.js";
import { buildRtspPlaybackUrl, testRtspConnectivity, validateRtspUrl } from "../../lib/rtsp.js";

function normalizeOptionalText(value?: string | null): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeAdvertisedHost(value?: string | null): string | null | undefined {
  const normalized = normalizeOptionalText(value);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }
  return normalized.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function deriveSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || fallback;
}

function getBaseUrlHost(config: AppConfig): string {
  return new URL(config.baseUrl).hostname;
}

function getWorkerAdvertisedHost(record: StreamRecord, config: AppConfig): string | null {
  return normalizeAdvertisedHost(record.advertised_host) ?? (config.appRole === "worker" ? getBaseUrlHost(config) : null);
}

function getWorkerOnvifPath(record: StreamRecord, suffix: "device_service" | "media_service" | "snapshot", config: AppConfig): string {
  return config.appRole === "worker" ? `/onvif/${suffix}` : `/onvif/${record.id}/${suffix}`;
}

function getPredictedWorkerOnvifPath(record: StreamRecord, suffix: "device_service" | "media_service" | "snapshot"): string {
  return record.worker_mode === "dedicated" ? `/onvif/${suffix}` : `/onvif/${record.id}/${suffix}`;
}

function getWorkerBaseUrl(record: StreamRecord, config: AppConfig): string | null {
  const advertisedHost = getWorkerAdvertisedHost(record, config);
  const workerHttpPort = record.worker_http_port ?? config.port;
  return advertisedHost ? `http://${advertisedHost}:${workerHttpPort}` : null;
}

function getWorkerRtspUrl(record: StreamRecord, config: AppConfig): string | null {
  const advertisedHost = getWorkerAdvertisedHost(record, config);
  if (!advertisedHost) {
    return null;
  }
  return `rtsp://${advertisedHost}:${config.go2rtcRtspPort}/${config.go2rtcStreamName}`;
}

function buildGo2RtcSource(record: StreamRecord, config: AppConfig): string {
  const upstreamUrl = buildRtspPlaybackUrl(record.rtsp_url, getStreamCredentials(record, config));
  if (record.go2rtc_mode !== "ffmpeg") {
    return upstreamUrl;
  }

  const parts = [`ffmpeg:${upstreamUrl}`];
  if (record.go2rtc_video) {
    parts.push(`video=${record.go2rtc_video}`);
  }
  if (record.go2rtc_audio) {
    parts.push(`audio=${record.go2rtc_audio}`);
  }
  if (record.go2rtc_raw) {
    parts.push(`raw=${record.go2rtc_raw.replace(/\s+/g, " ").trim()}`);
  }
  return parts.join("#");
}

function yamlScalar(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function serializeStream(record: StreamRecord, config: AppConfig) {
  const workerHttpPort = record.worker_http_port ?? config.port;
  const advertisedHost = getWorkerAdvertisedHost(record, config);
  const workerSlug = deriveSlug(record.name, record.id.slice(0, 8));
  const workerBaseUrl = getWorkerBaseUrl(record, config);
  const workerDeviceServiceUrl = workerBaseUrl
    ? `${workerBaseUrl}${getPredictedWorkerOnvifPath(record, "device_service")}`
    : null;
  const workerMediaServiceUrl = workerBaseUrl ? `${workerBaseUrl}${getPredictedWorkerOnvifPath(record, "media_service")}` : null;
  const workerSnapshotUrl = workerBaseUrl ? `${workerBaseUrl}${getPredictedWorkerOnvifPath(record, "snapshot")}` : null;
  const workerRtspUrl = getWorkerRtspUrl(record, config);

  return {
    id: record.id,
    name: record.name,
    description: record.description,
    rtspUrl: record.rtsp_url,
    active: Boolean(record.active),
    status: record.last_status,
    lastError: record.last_error,
    lastCheckAt: record.last_check_at,
    lastLatencyMs: record.last_latency_ms,
    recorderNotes: record.recorder_notes,
    hasStoredCredentials: Boolean(record.username_enc || record.password_enc),
    onvif: {
      endpoint: getWorkerOnvifPath(record, "device_service", config),
      deviceServiceUrl: `${config.baseUrl}${getWorkerOnvifPath(record, "device_service", config)}`,
      mediaServiceUrl: `${config.baseUrl}${getWorkerOnvifPath(record, "media_service", config)}`,
      profileToken: "main",
      name: record.onvif_name ?? record.name,
      manufacturer: record.onvif_manufacturer ?? "UbiRSTP2ONVIF",
      model: record.onvif_model ?? "Virtual RTSP Bridge",
      hardwareId: record.onvif_hardware_id ?? "virtual-bridge",
      firmwareVersion: record.onvif_firmware_version ?? config.version
    },
    worker: {
      mode: record.worker_mode,
      advertisedHost,
      httpPort: workerHttpPort,
      networkName: record.worker_network_name,
      serviceName: `camera-${workerSlug}`,
      containerName: `ubirstp2onvif-${workerSlug}`,
      requiresDedicatedIp: record.worker_mode === "dedicated",
      baseUrl: workerBaseUrl,
      deviceServiceUrl: workerDeviceServiceUrl,
      mediaServiceUrl: workerMediaServiceUrl,
      snapshotUrl: workerSnapshotUrl,
      rtspUrl: workerRtspUrl,
      adoptUrl: workerDeviceServiceUrl,
      go2rtc: {
        mode: record.go2rtc_mode,
        streamName: config.go2rtcStreamName,
        apiPort: config.go2rtcApiPort,
        rtspPort: config.go2rtcRtspPort,
        source: buildGo2RtcSource(record, config),
        video: record.go2rtc_video,
        audio: record.go2rtc_audio,
        raw: record.go2rtc_raw
      }
    },
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

export function normalizeStreamInput(input: StreamInput): StreamInput {
  const validated = validateRtspUrl(input.rtspUrl);
  return {
    ...input,
    rtspUrl: validated.sanitizedUrl,
    advertisedHost: normalizeAdvertisedHost(input.advertisedHost),
    workerNetworkName: normalizeOptionalText(input.workerNetworkName),
    workerMode: input.workerMode ?? "shared",
    go2rtcMode: input.go2rtcMode ?? "direct",
    go2rtcVideo: normalizeOptionalText(input.go2rtcVideo),
    go2rtcAudio: normalizeOptionalText(input.go2rtcAudio),
    go2rtcRaw: normalizeOptionalText(input.go2rtcRaw)
  };
}

export function createStreamWithValidation(db: DbHandle, config: AppConfig, input: StreamInput) {
  return createStream(db, config, normalizeStreamInput(input));
}

export function updateStreamWithValidation(db: DbHandle, config: AppConfig, streamId: string, input: Partial<StreamInput>) {
  const candidate = {
    ...input,
    ...(input.rtspUrl ? { rtspUrl: validateRtspUrl(input.rtspUrl).sanitizedUrl } : {}),
    ...(input.advertisedHost !== undefined ? { advertisedHost: normalizeAdvertisedHost(input.advertisedHost) } : {}),
    ...(input.workerNetworkName !== undefined ? { workerNetworkName: normalizeOptionalText(input.workerNetworkName) } : {}),
    ...(input.go2rtcVideo !== undefined ? { go2rtcVideo: normalizeOptionalText(input.go2rtcVideo) } : {}),
    ...(input.go2rtcAudio !== undefined ? { go2rtcAudio: normalizeOptionalText(input.go2rtcAudio) } : {}),
    ...(input.go2rtcRaw !== undefined ? { go2rtcRaw: normalizeOptionalText(input.go2rtcRaw) } : {}),
    ...(input.go2rtcMode !== undefined ? { go2rtcMode: input.go2rtcMode } : {})
  };
  return updateStream(db, config, streamId, candidate);
}

export async function runStreamHealthCheck(
  db: DbHandle,
  config: AppConfig,
  streamId: string
): Promise<ReturnType<typeof serializeStream>> {
  const stream = getStreamById(db, streamId);
  if (!stream) {
    throw new Error("Stream not found.");
  }

  try {
    const response = await testRtspConnectivity(
      buildRtspPlaybackUrl(stream.rtsp_url, getStreamCredentials(stream, config))
    );
    updateStreamHealth(db, stream.id, {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      error: null,
      latencyMs: response.latencyMs
    });
  } catch (error) {
    updateStreamHealth(db, stream.id, {
      status: "error",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown RTSP health check error"
    });
  }

  return serializeStream(getStreamById(db, streamId)!, config);
}

export function getPlaybackUrl(record: StreamRecord, config: AppConfig): string {
  if (config.appRole === "worker") {
    return getWorkerRtspUrl(record, config) ?? buildRtspPlaybackUrl(record.rtsp_url, getStreamCredentials(record, config));
  }
  return buildRtspPlaybackUrl(record.rtsp_url, getStreamCredentials(record, config));
}

export function buildWorkerDeploymentSpec(record: StreamRecord, config: AppConfig) {
  const stream = serializeStream(record, config);
  const networkSection = stream.worker.networkName
    ? [
        "    networks:",
        `      ${stream.worker.networkName}:`,
        `        ipv4_address: ${yamlScalar(stream.worker.advertisedHost ?? "192.168.1.10")}`
      ]
    : ["    networks:", "      default: {}"];
  const externalNetworkSection = stream.worker.networkName
    ? ["networks:", `  ${stream.worker.networkName}:`, "    external: true"]
    : [];
  const go2rtcConfig = [
    "streams:",
    `  ${config.go2rtcStreamName}:`,
    `    - ${yamlScalar(buildGo2RtcSource(record, config))}`,
    "api:",
    `  listen: ${yamlScalar(`:${config.go2rtcApiPort}`)}`,
    "rtsp:",
    `  listen: ${yamlScalar(`:${config.go2rtcRtspPort}`)}`
  ].join("\n");
  const composeYaml = [
    "services:",
    `  ${stream.worker.serviceName}:`,
    `    image: ${yamlScalar("ghcr.io/itsh-neumeier/ubirstp2onvif:latest")}`,
    `    container_name: ${yamlScalar(stream.worker.containerName)}`,
    "    environment:",
    `      APP_ROLE: ${yamlScalar("worker")}`,
    `      WORKER_STREAM_ID: ${yamlScalar(record.id)}`,
    `      APP_BASE_URL: ${yamlScalar(stream.worker.baseUrl ?? `http://camera.local:${stream.worker.httpPort}`)}`,
    `      PORT: ${stream.worker.httpPort}`,
    `      DATA_DIR: ${yamlScalar("/data")}`,
    `      GO2RTC_RTSP_PORT: ${config.go2rtcRtspPort}`,
    `      GO2RTC_API_PORT: ${config.go2rtcApiPort}`,
    `      GO2RTC_STREAM_NAME: ${yamlScalar(config.go2rtcStreamName)}`,
    `      ONVIF_USERNAME: ${yamlScalar(config.onvifUsername)}`,
    `      ONVIF_PASSWORD: ${yamlScalar(config.onvifPassword ?? "change-me-now")}`,
    `      ONVIF_DISCOVERY_ENABLED: ${yamlScalar("true")}`,
    "    volumes:",
    `      - ${yamlScalar("ubirstp2onvif-control-plane-data:/data")}`,
    "    restart: unless-stopped",
    ...networkSection,
    `  ${stream.worker.serviceName}-go2rtc:`,
    `    image: ${yamlScalar("alexxit/go2rtc:latest")}`,
    `    container_name: ${yamlScalar(`${stream.worker.containerName}-go2rtc`)}`,
    `    network_mode: ${yamlScalar(`service:${stream.worker.serviceName}`)}`,
    `    working_dir: ${yamlScalar("/config")}`,
    "    volumes:",
    `      - ${yamlScalar("./go2rtc.yaml:/config/go2rtc.yaml:ro")}`,
    "    restart: unless-stopped",
    "",
    "volumes:",
    "  ubirstp2onvif-control-plane-data:",
    "    name: ubirstp2onvif-control-plane-data",
    ...externalNetworkSection
  ]
    .filter(Boolean)
    .join("\n");

  return {
    streamId: record.id,
    name: record.name,
    worker: stream.worker,
    mode: record.worker_mode as WorkerMode,
    composeProjectName: "ubirstp2onvif",
    serviceName: stream.worker.serviceName,
    containerName: stream.worker.containerName,
    image: "compose-preview-only",
    networkName: record.worker_network_name ?? null,
    discoveryPort: config.onvifDiscoveryPort,
    httpPort: stream.worker.httpPort,
    advertisedHost: stream.worker.advertisedHost,
    workerBaseUrl: stream.worker.baseUrl,
    adoptUrl: stream.worker.adoptUrl,
    requiresDedicatedIp: stream.worker.requiresDedicatedIp,
    go2rtc: stream.worker.go2rtc,
    composeYaml,
    go2rtcConfig,
    ports: stream.worker.requiresDedicatedIp ? [] : [`${stream.worker.httpPort}:${stream.worker.httpPort}`, `${config.onvifDiscoveryPort}:${config.onvifDiscoveryPort}/udp`],
    volumes: ["/data"],
    notes:
      record.worker_mode === "dedicated"
        ? [
            "Use a dedicated LAN IP per worker.",
            "Bind the worker to a macvlan or ipvlan network in Compose.",
            "Mount the same named data volume as the control-plane so the worker can read the selected stream definition.",
            "The bundled go2rtc sidecar shares the worker network namespace and serves RTSP on the same camera IP."
          ]
        : [
            "Shared mode keeps the current single-process deployment pattern.",
            "Dedicated worker IPs are required for UniFi Protect adoption."
          ]
  };
}

export async function runScheduledHealthChecks(
  db: DbHandle,
  config: AppConfig,
  logger: FastifyBaseLogger
): Promise<void> {
  const activeStreams = listStreams(db).filter((stream) => Boolean(stream.active));
  for (const stream of activeStreams) {
    try {
      await runStreamHealthCheck(db, config, stream.id);
    } catch (error) {
      logger.warn(
        { streamId: stream.id, message: error instanceof Error ? error.message : "Unknown error" },
        "Scheduled stream health check failed"
      );
    }
  }
}
