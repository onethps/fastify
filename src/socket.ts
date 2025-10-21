import type { DecodedIdToken } from "firebase-admin/auth";
import { authenticateSocket } from "./auth.js";
import { getFirestore } from "./firebase.js";

export function extractToken(socket: any): string | null {
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token as string;
  const headerToken =
    socket.handshake.headers.authorization?.split("Bearer ")[1];

  return authToken || queryToken || headerToken || null;
}

export async function authenticateConnection(
  token: string
): Promise<DecodedIdToken> {
  if (!token) {
    throw new Error("No authentication token provided");
  }

  try {
    return await authenticateSocket(token);
  } catch (error) {
    // If token is expired, provide a more helpful error message
    if (error instanceof Error && error.message.includes("expired")) {
      throw new Error(
        "Token has expired. Please refresh your authentication token on the client side."
      );
    }
    throw error;
  }
}

export function setupSocketEvents(
  socket: any,
  userId: string,
  activeUsers: Map<string, any>,
  logger: any,
  tournamentManager?: any
) {
  socket.emit("CONNECTED", { userId });
  logger.info(`✅ User connected: ${userId}`);

  socket.on("disconnect", (reason: string) => {
    logger.info(`❌ User ${userId} disconnected: ${reason}`);
    activeUsers.delete(userId);

    if (tournamentManager) {
      tournamentManager.removeConnectedUser(userId);
    }
  });
}

export function handleConnectionError(socket: any, error: any, logger: any) {
  logger.error("Authentication failed:", error);
  socket.emit("ERROR", {
    message: "Authentication failed",
    code: "UNAUTHORIZED",
  });
  socket.disconnect(true);
}
