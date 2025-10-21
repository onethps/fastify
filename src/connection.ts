import {
  extractToken,
  authenticateConnection,
  setupSocketEvents,
  handleConnectionError,
} from "./socket.js";
import { Socket } from "socket.io";
export async function handleConnection(
  socket: any,
  activeUsers: Map<string, any>,
  logger: any,
  tournamentManager?: any
) {
  try {
    const token = extractToken(socket);
    if (!token) {
      throw new Error("No authentication token provided");
    }

    const decodedToken = await authenticateConnection(token);
    const userId = decodedToken.uid;

    activeUsers.set(userId, socket);

    setupHeartbeat(socket, userId);

    setupSocketEvents(socket, userId, activeUsers, logger, tournamentManager);
  } catch (error) {
    handleConnectionError(socket, error, logger);
  }
}

export function setupHeartbeat(socket: Socket, userId: string): void {
  const heartbeatInterval = setInterval(async () => {
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

  socket.on("pong", async () => {});
}
