import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createUser,
  deleteUserSessions,
  getUserById,
  listUsers,
  resetUserPassword,
  updateUser,
  type UserRecord
} from "../../db/database.js";
import { requireAdmin } from "../../plugins/auth-context.js";

const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().min(1).max(100),
  password: z.string().min(12).max(256),
  role: z.enum(["admin", "viewer"]),
  locale: z.enum(["en", "de"]).default("en")
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(["admin", "viewer"]).optional(),
  locale: z.enum(["en", "de"]).optional(),
  disabled: z.boolean().optional()
});

const resetPasswordSchema = z.object({
  password: z.string().min(12).max(256)
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

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return;
    }
    reply.send({ users: listUsers(app.db).map(serializeUser) });
  });

  app.post("/api/users", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return;
    }
    const payload = createUserSchema.parse(request.body ?? {});
    const user = await createUser(app.db, payload);
    reply.code(201).send({ user: serializeUser(user) });
  });

  app.patch("/api/users/:userId", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return;
    }
    const params = request.params as { userId: string };
    const payload = updateUserSchema.parse(request.body ?? {});
    const user = updateUser(app.db, params.userId, {
      display_name: payload.displayName,
      role: payload.role,
      locale: payload.locale,
      disabled: payload.disabled === undefined ? undefined : payload.disabled ? 1 : 0
    });
    if (!user) {
      reply.code(404).send({ error: "User not found." });
      return;
    }
    if (payload.disabled) {
      deleteUserSessions(app.db, user.id);
    }
    reply.send({ user: serializeUser(user) });
  });

  app.post("/api/users/:userId/reset-password", async (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return;
    }
    const params = request.params as { userId: string };
    const user = getUserById(app.db, params.userId);
    if (!user) {
      reply.code(404).send({ error: "User not found." });
      return;
    }
    const payload = resetPasswordSchema.parse(request.body ?? {});
    await resetUserPassword(app.db, user.id, payload.password);
    deleteUserSessions(app.db, user.id);
    reply.code(204).send();
  });
}
