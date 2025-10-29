import { Socket, Server as SocketServer } from "socket.io";
import { MediaState, FIRESTORE_COLLECTIONS } from "./types/tournament.types";

export class TournamentSocketHandlers {
  private io: SocketServer;
  private tournamentManager: any;
  private roomManager: any;
  private firestore: any;

  constructor(
    io: SocketServer,
    tournamentManager: any,
    roomManager: any,
    firestore: any
  ) {
    this.io = io;
    this.tournamentManager = tournamentManager;
    this.roomManager = roomManager;
    this.firestore = firestore;
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

        await this.tournamentManager.startTimer(tournamentId);

        socket.join(`tournament:${tournamentId}`);
        socket.join(`user:${userId}`);

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

    socket.on("tournament:reset_start", async (tournamentId, callback) => {
      try {
        console.log("tournament:reset_start", tournamentId);
        const tournament = await this.tournamentManager.restetTournamentStartAt(
          tournamentId
        );
        callback(true);
      } catch (error: any) {
        console.error("Error resetting tournament start:", error);
        callback(false);
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

    socket.on("room:get_data", async (roomId, callback) => {
      try {
        const room = await this.roomManager.getRoom(roomId);
        if (room) {
          callback(room);
        } else {
          callback(null, "Room not found");
        }
      } catch (error: any) {
        callback(null, error.message);
      }
    });

    // Admin handlers
    socket.on("admin:get_all_tournaments", async (callback) => {
      try {
        const tournamentsSnapshot = await this.firestore
          .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
          .get();

        const tournaments = tournamentsSnapshot.docs.map((doc: any) => ({
          id: doc.id,
          ...doc.data(),
          createdAt:
            doc.data().createdAt?.toDate?.()?.toISOString() ||
            doc.data().createdAt,
          startedAt:
            doc.data().startedAt?.toDate?.()?.toISOString() ||
            doc.data().startedAt,
          completedAt:
            doc.data().completedAt?.toDate?.()?.toISOString() ||
            doc.data().completedAt,
        }));

        callback(tournaments);
      } catch (error: any) {
        callback(null, error.message);
      }
    });

    socket.on(
      "admin:get_tournament_details",
      async (tournamentId, callback) => {
        try {
          const tournament = await this.tournamentManager.getTournament(
            tournamentId
          );
          if (!tournament) {
            callback(null, "Tournament not found");
            return;
          }

          // Get all rounds
          const roundsSnapshot = await this.firestore
            .collection(FIRESTORE_COLLECTIONS.ROUNDS)
            .where("tournamentId", "==", tournamentId)
            .get();

          const rounds = await Promise.all(
            roundsSnapshot.docs.map(async (doc: any) => {
              const round = { id: doc.id, ...doc.data() };

              // Get rooms for each round
              const roomIds = round.rooms || [];
              const rooms = await Promise.all(
                roomIds.map(async (roomId: string) => {
                  const room = await this.roomManager.getRoom(roomId);
                  return room || null;
                })
              );

              return {
                ...round,
                rooms: rooms.filter((r) => r !== null),
                startedAt:
                  round.startedAt?.toDate?.()?.toISOString() || round.startedAt,
                completedAt:
                  round.completedAt?.toDate?.()?.toISOString() ||
                  round.completedAt,
              };
            })
          );

          callback({
            tournament: {
              ...tournament,
              createdAt:
                tournament.createdAt?.toDate?.()?.toISOString() ||
                tournament.createdAt,
              startedAt:
                tournament.startedAt?.toDate?.()?.toISOString() ||
                tournament.startedAt,
              completedAt:
                tournament.completedAt?.toDate?.()?.toISOString() ||
                tournament.completedAt,
            },
            rounds,
          });
        } catch (error: any) {
          callback(null, error.message);
        }
      }
    );

    socket.on("admin:get_room_details", async (roomId, callback) => {
      try {
        const room = await this.roomManager.getRoom(roomId);
        if (!room) {
          callback(null, "Room not found");
          return;
        }

        callback({
          ...room,
          createdAt:
            room.createdAt?.toDate?.()?.toISOString() || room.createdAt,
          startedAt:
            room.startedAt?.toDate?.()?.toISOString() || room.startedAt,
          completedAt:
            room.completedAt?.toDate?.()?.toISOString() || room.completedAt,
        });
      } catch (error: any) {
        callback(null, error.message);
      }
    });

    socket.on("admin:kick_user", async (tournamentId, userId, callback) => {
      try {
        const tournament = await this.tournamentManager.getTournament(
          tournamentId
        );
        if (!tournament) {
          callback(false, "Tournament not found");
          return;
        }

        // Remove user from tournament participants
        tournament.participants = tournament.participants.filter(
          (id: string) => id !== userId
        );
        await this.firestore
          .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
          .doc(tournamentId)
          .update({ participants: tournament.participants });

        // Get user's room and remove them
        const roomId = await this.roomManager.getRoomByUserId(userId);
        if (roomId) {
          await this.roomManager.leaveRoom(roomId, userId, socket.id);
          this.io.to(roomId).emit("participant:kicked", roomId, userId);
        }

        // Disconnect user
        this.io.to(`user:${userId}`).emit("tournament:removed", tournamentId);
        this.io.socketsLeave(`user:${userId}`);

        callback(true);
      } catch (error: any) {
        console.error("Error kicking user:", error);
        callback(false, error.message);
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
