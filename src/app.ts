import { getFirestore } from "./firebase.js"; // your Firestore instance
import { startServer } from "./server.js";
import { initializeFirebase } from "./firebase.js";
import { createServer, setupRoutes } from "./server.js";
import { handleConnection } from "./connection.js";

import { authenticateConnection, extractToken } from "./socket.js";
import { TournamentManager } from "./managers/TournamentManager.js";

import { TournamentSocketHandlers } from "./TournamentHandlers.js";
import { RoomManager } from "./managers/RoomManager.js";

async function main() {
  try {
    initializeFirebase();

    const server = await createServer();
    const activeUsers = new Map();

    setupRoutes(server, activeUsers);

    const firestore = getFirestore();

    const tournamentManager = new TournamentManager(server.io, firestore);
    const roomManager = new RoomManager(server.io, firestore);

    server.ready().then(() => {
      server.io.on("connection", async (socket) => {
        const token = extractToken(socket);
        if (!token) {
          throw new Error("No authentication token provided");
        }

        const decodedToken = await authenticateConnection(token);
        const userId = decodedToken.uid;

        tournamentManager.addConnectedUser(userId);

        const handlers = new TournamentSocketHandlers(
          server.io,
          tournamentManager,
          roomManager
        );

        handlers.registerHandlers(socket, userId);

        handleConnection(socket, activeUsers, server.log, tournamentManager);
      });
    });
    await startServer(server);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
