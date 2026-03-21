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
  type StreamRecord
} from "../../db/database.js";
import { buildRtspPlaybackUrl, testRtspConnectivity, validateRtspUrl } from "../../lib/rtsp.js";

export function serializeStream(record: StreamRecord, config: AppConfig) {
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
      endpoint: `/onvif/${record.id}/device_service`,
      deviceServiceUrl: `${config.baseUrl}/onvif/${record.id}/device_service`,
      mediaServiceUrl: `${config.baseUrl}/onvif/${record.id}/media_service`,
      profileToken: "main",
      name: record.onvif_name ?? record.name,
      manufacturer: record.onvif_manufacturer ?? "UbiRSTP2ONVIF",
      model: record.onvif_model ?? "Virtual RTSP Bridge",
      hardwareId: record.onvif_hardware_id ?? "virtual-bridge",
      firmwareVersion: record.onvif_firmware_version ?? config.version
    },
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

export function normalizeStreamInput(input: StreamInput): StreamInput {
  const validated = validateRtspUrl(input.rtspUrl);
  return {
    ...input,
    rtspUrl: validated.sanitizedUrl
  };
}

export function createStreamWithValidation(db: DbHandle, config: AppConfig, input: StreamInput) {
  return createStream(db, config, normalizeStreamInput(input));
}

export function updateStreamWithValidation(db: DbHandle, config: AppConfig, streamId: string, input: Partial<StreamInput>) {
  const candidate = input.rtspUrl ? { ...input, rtspUrl: validateRtspUrl(input.rtspUrl).sanitizedUrl } : input;
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
  return buildRtspPlaybackUrl(record.rtsp_url, getStreamCredentials(record, config));
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
