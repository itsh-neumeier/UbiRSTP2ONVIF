import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { createDatabase, ensureDefaultAdmin } from "./db/database.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerOnvifRoutes, startOnvifDiscovery } from "./modules/onvif/routes.js";
import { runScheduledHealthChecks } from "./modules/streams/service.js";
import { registerStreamRoutes } from "./modules/streams/routes.js";
import { registerSystemRoutes } from "./modules/system/routes.js";
import { registerUserRoutes } from "./modules/users/routes.js";
import { authContextPlugin } from "./plugins/auth-context.js";

declare module "fastify" {
  interface FastifyInstance {
    config: ReturnType<typeof loadConfig>;
    db: ReturnType<typeof createDatabase>;
  }
}

function resolveWebDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../web/dist");
}

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.env === "production" ? "info" : "debug"
    }
  });

  const db = createDatabase(config);
  app.decorate("config", config);
  app.decorate("db", db);

  for (const contentType of ["application/soap+xml", "application/xml", "text/xml"]) {
    app.addContentTypeParser(contentType, { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
  }

  await app.register(cookie, { secret: config.cookieSecret });
  await app.register(authContextPlugin, { db, config });
  await registerSystemRoutes(app);
  await registerOnvifRoutes(app);

  if (config.appRole === "control-plane") {
    await ensureDefaultAdmin(db, config, app.log);
    await registerAuthRoutes(app);
    await registerUserRoutes(app);
    await registerStreamRoutes(app);
  }

  const webDist = resolveWebDist();
  if (config.appRole === "control-plane" && existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false
    });
  }

  let healthTimer: NodeJS.Timeout | null = null;
  if (config.appRole === "control-plane") {
    healthTimer = setInterval(() => {
      void runScheduledHealthChecks(db, config, app.log);
    }, config.healthcheckIntervalSeconds * 1000);
    healthTimer.unref();
  }

  const discoverySocket = startOnvifDiscovery(app);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "Not found." });
      return;
    }

    if (existsSync(join(webDist, "index.html"))) {
      reply.type("text/html; charset=utf-8").send(await readFile(join(webDist, "index.html"), "utf8"));
      return;
    }

    reply.code(404).type("text/html; charset=utf-8").send(`
      <!doctype html>
      <html lang="en"><body style="font-family:sans-serif;padding:2rem">
        <h1>404</h1><p>UbiRSTP2ONVIF could not find the requested page.</p>
      </body></html>
    `);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled request error");
    if (request.url.startsWith("/api/")) {
      reply.code(500).send({ error: "Internal server error." });
      return;
    }
    reply.code(500).type("text/html; charset=utf-8").send(`
      <!doctype html>
      <html lang="en"><body style="font-family:sans-serif;padding:2rem">
        <h1>500</h1><p>UbiRSTP2ONVIF encountered an unexpected error.</p>
      </body></html>
    `);
  });

  app.addHook("onClose", async () => {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    if (discoverySocket) {
      discoverySocket.close();
    }
    db.close();
  });

  return app;
}
