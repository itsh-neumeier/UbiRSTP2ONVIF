import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { deleteStream, getStreamById, listStreams } from "../../db/database.js";
import { requireAuth } from "../../plugins/auth-context.js";
import {
  buildWorkerDeploymentSpec,
  createStreamWithValidation,
  runStreamHealthCheck,
  serializeStream,
  updateStreamWithValidation
} from "./service.js";

const streamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  rtspUrl: z.string().url(),
  username: z.string().max(120).optional().nullable(),
  password: z.string().max(256).optional().nullable(),
  active: z.boolean().default(true),
  recorderNotes: z.string().max(500).optional(),
  onvifName: z.string().max(120).optional().nullable(),
  onvifManufacturer: z.string().max(120).optional().nullable(),
  onvifModel: z.string().max(120).optional().nullable(),
  onvifHardwareId: z.string().max(120).optional().nullable(),
  onvifFirmwareVersion: z.string().max(120).optional().nullable(),
  workerMode: z.enum(["shared", "dedicated"]).default("shared"),
  advertisedHost: z.string().max(255).optional().nullable(),
  workerHttpPort: z.coerce.number().int().positive().max(65535).optional().nullable(),
  workerNetworkName: z.string().max(120).optional().nullable(),
  go2rtcMode: z.enum(["direct", "ffmpeg"]).default("direct"),
  go2rtcVideo: z.string().max(120).optional().nullable(),
  go2rtcAudio: z.string().max(120).optional().nullable(),
  go2rtcRaw: z.string().max(4000).optional().nullable()
});

const patchSchema = streamSchema.partial();

export async function registerStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/streams", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    reply.send({ streams: listStreams(app.db).map((stream) => serializeStream(stream, app.config)) });
  });

  app.post("/api/streams", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const payload = streamSchema.parse(request.body ?? {});
    const stream = createStreamWithValidation(app.db, app.config, payload);
    reply.code(201).send({ stream: serializeStream(stream, app.config) });
  });

  app.get("/api/streams/:streamId", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const stream = getStreamById(app.db, params.streamId);
    if (!stream) {
      reply.code(404).send({ error: "Stream not found." });
      return;
    }
    reply.send({ stream: serializeStream(stream, app.config) });
  });

  app.get("/api/streams/:streamId/compose", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const stream = getStreamById(app.db, params.streamId);
    if (!stream) {
      reply.code(404).send({ error: "Stream not found." });
      return;
    }
    reply.send({
      stream: serializeStream(stream, app.config),
      deployment: buildWorkerDeploymentSpec(stream, app.config)
    });
  });

  app.patch("/api/streams/:streamId", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const payload = patchSchema.parse(request.body ?? {});
    const stream = updateStreamWithValidation(app.db, app.config, params.streamId, payload);
    if (!stream) {
      reply.code(404).send({ error: "Stream not found." });
      return;
    }
    reply.send({ stream: serializeStream(stream, app.config) });
  });

  app.delete("/api/streams/:streamId", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const deleted = deleteStream(app.db, params.streamId);
    if (!deleted) {
      reply.code(404).send({ error: "Stream not found." });
      return;
    }
    reply.code(204).send();
  });

  app.post("/api/streams/:streamId/test", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const stream = await runStreamHealthCheck(app.db, app.config, params.streamId);
    reply.send({ stream });
  });

  app.post("/api/streams/:streamId/start", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const stream = updateStreamWithValidation(app.db, app.config, params.streamId, { active: true });
    if (!stream) {
      reply.code(404).send({ error: "Stream not found." });
      return;
    }
    reply.send({ stream: serializeStream(stream, app.config) });
  });

  app.post("/api/streams/:streamId/stop", async (request, reply) => {
    if (!requireAuth(request, reply)) {
      return;
    }
    const params = request.params as { streamId: string };
    const stream = updateStreamWithValidation(app.db, app.config, params.streamId, { active: false });
    if (!stream) {
      reply.code(404).send({ error: "Stream not found." });
      return;
    }
    reply.send({ stream: serializeStream(stream, app.config) });
  });
}
