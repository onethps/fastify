import { Socket, Server as SocketServer } from "socket.io";
import { MediaState } from "./types/tournament.types";

export class TournamentSocketHandlers {
  private io: SocketServer;
  private tournamentManager: any;
  private roomManager: any;

  constructor(io: SocketServer, tournamentManager: any, roomManager: any) {
    this.io = io;
    this.tournamentManager = tournamentManager;
    this.roomManager = roomManager;
  }

  registerHandlers(socket: Socket, userId: string): void {
    socket.on("tournament:join", async (tournamentId, callback) => {
      try {
        const tournament = await this.tournamentManager.getTournament(
          tournamentId
        );
        if (!tournament) {
          throw new Error("Tournament not found");
        }

        this.tournamentManager.addConnectedUser(userId);

        await this.tournamentManager.startTimer(tournamentId);

        socket.join(`tournament:${tournamentId}`);
        socket.join(`user:${userId}`); // Join user to their personal room for targeted events

        callback(true);
      } catch (error: any) {
        callback(false, error.message);
      }
    });

    socket.on("tournament:register", async (tournamentId, callback) => {
      try {
        const success = await this.tournamentManager.registerParticipant(
          tournamentId,
          userId
        );
        callback(success);
      } catch (error: any) {
        callback(false, error.message);
      }
    });

    socket.on("tournament:create", async (data, callback) => {
      try {
        const tournament = await this.tournamentManager.createTournament({
          ...data,
          createdBy: userId,
        });
        callback(tournament);
      } catch (error: any) {
        callback(null, error.message);
      }
    });

    socket.on("room:join", async (roomId, callback) => {
      try {
        await this.roomManager.joinRoom(roomId, userId, socket.id);
        socket.join(roomId);
        callback(true);
      } catch (error: any) {
        callback(false, error.message);
      }
    });

    socket.on("performance:skip_preparation", async (roomId) => {
      try {
        await this.roomManager.skipPreparationTimer(roomId);
      } catch (error) {
        console.error("Error skipping preparation timer:", error);
      }
    });

    socket.on("vote:submit", async (roomId, votes, callback) => {
      try {
        await this.roomManager.submitVote(roomId, userId, votes);
        callback(true);
      } catch (error: any) {
        console.error("Error submitting vote:", error);
        callback(false);
      }
    });

    socket.on("media:toggle_mute", async (roomId, isMuted) => {
      await this.updateMediaState(roomId, userId, { isMuted });
    });

    socket.on("media:toggle_camera", async (roomId, isCameraOn) => {
      await this.updateMediaState(roomId, userId, { isCameraOn });
    });

    socket.on("media:toggle_screen", async (roomId, isSharing) => {
      await this.updateMediaState(roomId, userId, {
        isScreenSharing: isSharing,
      });
    });

    socket.on("admin:start_tournament", async (tournamentId) => {
      try {
        await this.tournamentManager.startTournament(tournamentId);
      } catch (error) {
        console.error("Error starting tournament:", error);
      }
    });

    socket.on("admin:pause_timer", async (roomId) => {
      try {
        await this.roomManager.pauseTimer(roomId);
      } catch (error) {
        console.error("Error pausing timer:", error);
      }
    });

    socket.on("admin:resume_timer", async (roomId) => {
      try {
        await this.roomManager.resumeTimer(roomId);
      } catch (error) {
        console.error("Error resuming timer:", error);
      }
    });

    socket.on("tournament:get_status", async (tournamentId, callback) => {
      try {
        const tournament = await this.tournamentManager.getTournament(
          tournamentId
        );
        if (!tournament) {
          callback(null, "Tournament not found");
          return;
        }
        callback(tournament);
      } catch (error: any) {
        callback(null, error.message);
      }
    });

    socket.on("user:get_assigned_room", async (tournamentId, callback) => {
      try {
        const roomId = await this.roomManager.getRoomByUserId(userId);
        if (roomId) {
          const room = await this.roomManager.getRoom(roomId);
          callback(room);
        } else {
          callback(null, "No room assigned");
        }
      } catch (error: any) {
        callback(null, error.message);
      }
    });

    socket.on("disconnect", async () => {
      await this.handleDisconnect(userId, socket.id);
    });
  }

  private async updateMediaState(
    roomId: string,
    userId: string,
    mediaState: Partial<MediaState>
  ): Promise<void> {
    const currentState: MediaState = {
      isMuted: false,
      isCameraOn: false,
      isScreenSharing: false,
    };

    const newState = { ...currentState, ...mediaState };

    this.io
      .to(roomId)
      .emit("participant:media_changed", roomId, userId, newState);
  }

  private async handleDisconnect(
    userId: string,
    socketId: string
  ): Promise<void> {
    this.tournamentManager.removeConnectedUser(userId);

    await this.tournamentManager.handleUserDisconnection(userId);

    const roomId = await this.roomManager.getRoomByUserId(userId);

    if (roomId) {
      await this.roomManager.leaveRoom(roomId, userId, socketId);
    }
  }
}

export async function authenticateSocket(
  socket: Socket,
  firebaseAuth: any
): Promise<string | null> {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      throw new Error("No token provided");
    }

    const decodedToken = await firebaseAuth.verifyIdToken(token);
    const userId = decodedToken.uid;

    return userId;
  } catch (error) {
    console.error("Socket authentication failed:", error);
    return null;
  }
}
