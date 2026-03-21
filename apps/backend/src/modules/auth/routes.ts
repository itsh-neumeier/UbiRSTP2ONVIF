import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createSession, deleteSession, getUserByUsername, verifyUserPassword, type UserRecord } from "../../db/database.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

function serializeUser(user: UserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    locale: user.locale,
    disabled: Boolean(user.disabled),
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const { username, password } = loginSchema.parse(request.body ?? {});
    const user = getUserByUsername(app.db, username);
    if (!user || user.disabled) {
      reply.code(401).send({ error: "Invalid username or password." });
      return;
    }

    const valid = await verifyUserPassword(user, password);
    if (!valid) {
      reply.code(401).send({ error: "Invalid username or password." });
      return;
    }

    const expiresAt = new Date(Date.now() + app.config.sessionTtlHours * 60 * 60 * 1000).toISOString();
    const session = createSession(app.db, {
      userId: user.id,
      expiresAt,
      remoteAddr: request.ip,
      userAgent: request.headers["user-agent"]
    });

    reply.setCookie(app.config.cookieName, session.id, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: app.config.cookieSecure,
      path: "/",
      expires: new Date(expiresAt)
    });

    reply.send({ user: serializeUser(user) });
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.currentUser) {
      reply.code(401).send({ error: "Authentication required." });
      return;
    }

    reply.send({ user: serializeUser(request.currentUser) });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const cookieValue = request.cookies[app.config.cookieName];
    if (cookieValue) {
      const unsigned = request.unsignCookie(cookieValue);
      if (unsigned.valid) {
        deleteSession(app.db, unsigned.value);
      }
    }
    reply.clearCookie(app.config.cookieName, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: app.config.cookieSecure
    });
    reply.code(204).send();
  });
}
