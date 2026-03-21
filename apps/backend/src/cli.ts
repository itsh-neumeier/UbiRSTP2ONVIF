import { buildApp } from "./app.js";
import { listUsers, resetUserPassword } from "./db/database.js";

const [, , command, ...args] = process.argv;
const app = await buildApp();

try {
  switch (command) {
    case "users:list": {
      const users = listUsers(app.db).map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        disabled: Boolean(user.disabled)
      }));
      console.log(JSON.stringify(users, null, 2));
      break;
    }
    case "users:reset-password": {
      const [userId, newPassword] = args;
      if (!userId || !newPassword) {
        throw new Error("Usage: users:reset-password <userId> <newPassword>");
      }
      await resetUserPassword(app.db, userId, newPassword);
      console.log(`Password updated for ${userId}`);
      break;
    }
    default:
      throw new Error("Supported commands: users:list, users:reset-password <userId> <newPassword>");
  }
} finally {
  await app.close();
}
