import type { FastifyInstance } from "fastify";

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    version: app.config.version,
    now: new Date().toISOString()
  }));

  app.get("/api/system/info", async (request) => ({
    appName: "UbiRSTP2ONVIF",
    version: app.config.version,
    githubUrl: app.config.githubUrl,
    baseUrl: app.config.baseUrl,
    locale: request.currentUser?.locale ?? "en",
    authenticated: Boolean(request.currentUser)
  }));
}
