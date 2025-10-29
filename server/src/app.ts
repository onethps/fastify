import { getFirestore } from "./firebase.js"; // your Firestore instance
import { startServer } from "./server.js";
import { initializeFirebase } from "./firebase.js";
import { createServer, setupRoutes } from "./server.js";

import { authenticateConnection, extractToken } from "./socket.js";
import { TournamentManager } from "./managers/TournamentManager.js";
import type { Socket } from "socket.io";

import { TournamentSocketHandlers } from "./TournamentHandlers.js";

async function main() {
  try {
    initializeFirebase();

    const server = await createServer();
    const activeUsers = new Map();

    setupRoutes(server, activeUsers);

    const firestore = getFirestore();

    const tournamentManager = new TournamentManager(
      server.io,
      firestore,
      activeUsers
    );

    server.ready().then(() => {
      server.io.on("connection", async (socket) => {
        try {
          const token = extractToken(socket);
          if (!token) {
            socket.emit("ERROR", {
              message: "No authentication token provided",
              code: "NO_TOKEN",
            });
            socket.disconnect(true);
            return;
          }

          const decodedToken = await authenticateConnection(token);
          const userId = decodedToken.uid;

          const handlers = new TournamentSocketHandlers(
            server.io,
            tournamentManager,
            tournamentManager.roomManager,
            firestore
          );

          handlers.registerHandlers(socket, userId);

          // Setup socket events and track active user
          activeUsers.set(userId, socket);

          socket.emit("CONNECTED", { userId });
          server.log.info(`✅ User connected: ${userId}`);

          // Setup heartbeat
          setupHeartbeat(socket, userId);

          socket.on("disconnect", (reason: string) => {
            server.log.info(`❌ User ${userId} disconnected: ${reason}`);
            activeUsers.delete(userId);
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Authentication failed";
          server.log.error(`Connection error: ${errorMessage}`);
          socket.emit("ERROR", {
            message: errorMessage,
            code: "AUTH_ERROR",
          });
          socket.disconnect(true);
        }
      });
    });
    await startServer(server);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

function setupHeartbeat(socket: Socket, userId: string): void {
  const heartbeatInterval = setInterval(() => {
    try {
      socket.emit("ping");
    } catch (error) {
      console.error("Heartbeat error:", error);
      clearInterval(heartbeatInterval);
    }
  }, 30000);

  socket.on("disconnect", () => {
    clearInterval(heartbeatInterval);
  });
}

main();
