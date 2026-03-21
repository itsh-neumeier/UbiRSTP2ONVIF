import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

import { deleteSession, getSession, getUserById, touchSession, type DbHandle, type UserRecord } from "../db/database.js";
import type { AppConfig } from "../config.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: UserRecord | null;
  }
}

export const authContextPlugin = fp<{ db: DbHandle; config: AppConfig }>(async (fastify, options) => {
  fastify.decorateRequest("currentUser", null);

  fastify.addHook("preHandler", async (request) => {
    const cookieValue = request.cookies[options.config.cookieName];
    if (!cookieValue) {
      request.currentUser = null;
      return;
    }
    const unsigned = request.unsignCookie(cookieValue);
    if (!unsigned.valid) {
      request.currentUser = null;
      return;
    }
    const sessionId = unsigned.value;

    const session = getSession(options.db, sessionId);
    if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
      deleteSession(options.db, sessionId);
      request.currentUser = null;
      return;
    }

    const user = getUserById(options.db, session.user_id);
    if (!user || user.disabled) {
      deleteSession(options.db, sessionId);
      request.currentUser = null;
      return;
    }

    request.currentUser = user;
    touchSession(options.db, session.id);
  });
});

export function requireAuth(request: FastifyRequest, reply: FastifyReply): UserRecord | null {
  if (!request.currentUser) {
    reply.code(401).send({ error: "Authentication required." });
    return null;
  }
  return request.currentUser;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): UserRecord | null {
  const user = requireAuth(request, reply);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    reply.code(403).send({ error: "Administrator access required." });
    return null;
  }
  return user;
}
