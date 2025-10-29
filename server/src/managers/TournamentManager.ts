import { Server as SocketServer } from "socket.io";
import { EventEmitter } from "events";
import {
  Tournament,
  TournamentStatus,
  TournamentRound,
  RoundStatus,
  TournamentRoom,
  ParticipantStatus,
  FIRESTORE_COLLECTIONS,
} from "../types/tournament.types";
import { RoomManager } from "./RoomManager";

export class TournamentManager extends EventEmitter {
  private io: SocketServer;
  private firestore: any;
  public roomManager: RoomManager;
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeUsers: Map<string, any>;

  constructor(io: SocketServer, firestore: any, activeUsers: Map<string, any>) {
    super();
    this.io = io;
    this.firestore = firestore;
    this.activeUsers = activeUsers;
    this.roomManager = new RoomManager(io, firestore);

    this.roomManager.on(
      "room:voting_completed",
      (roomId: string, roundId: string) => {
        this.handleRoomVotingCompleted(roomId, roundId);
      }
    );
  }

  private async getRoom(id: string): Promise<TournamentRoom | null> {
    const doc = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .doc(id)
      .get();

    return doc.exists ? (doc.data() as TournamentRoom) : null;
  }

  async createTournament(data: {
    name: string;
    description?: string;
    createdBy: string;
    maxParticipantsPerRoom?: number;
    performanceTimeSeconds?: number;
    votingTimeSeconds?: number;
    advancePerRoom?: number;
    perparingTimerSeconds?: number;
    startAt?: number;
  }): Promise<Tournament> {
    const tournament: Tournament = {
      id: this.generateId(),
      name: data.name,
      ...(data.description && { description: data.description }),
      status: TournamentStatus.CREATED,

      maxParticipantsPerRoom: data.maxParticipantsPerRoom || 5,
      performanceTimeSeconds: data.performanceTimeSeconds || 60,
      votingTimeSeconds: data.votingTimeSeconds || 20,
      advancePerRoom: data.advancePerRoom || 2,
      perparingTimerSeconds: data.perparingTimerSeconds || 10,

      currentRound: 0,
      totalRounds: 0,
      participants: [],

      createdBy: data.createdBy,
      createdAt: new Date(),
      ...(data.startAt && { startAt: data.startAt }),
    };

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
      .doc(tournament.id)
      .set(tournament);

    this.io.emit("tournament:created", tournament);

    console.log(
      `[TOURNAMENT STATUS] Tournament created: ${tournament.id} by ${data.createdBy}`
    );
    return tournament;
  }

  async registerParticipant(
    tournamentId: string,
    userId: string
  ): Promise<boolean> {
    const tournament = await this.getTournament(tournamentId);

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    if (
      tournament.status !== TournamentStatus.CREATED &&
      tournament.status !== TournamentStatus.REGISTRATION
    ) {
      throw new Error("Tournament registration is closed");
    }

    if (tournament.participants.includes(userId)) {
      return false;
    }

    tournament.participants.push(userId);
    tournament.status = TournamentStatus.REGISTRATION;

    await this.updateTournament(tournament);

    console.log(
      `[TOURNAMENT STATUS] User ${userId} registered for tournament ${tournamentId}`
    );

    this.io.emit("tournament:participant_registered", tournamentId, userId);

    return true;
  }

  async startTournament(tournamentId: string): Promise<void> {
    const tournament = await this.getTournament(tournamentId);

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    if (tournament.status === TournamentStatus.IN_PROGRESS) {
      throw new Error("Tournament already started");
    }

    const connectedUsers = Array.from(this.activeUsers.keys());

    if (connectedUsers.length < 2) {
      throw new Error("Not enough registered participants");
    }

    tournament.participants = connectedUsers;

    tournament.status = TournamentStatus.IN_PROGRESS;
    tournament.currentRound = 1;
    tournament.startedAt = new Date();
    tournament.id = tournamentId;

    await this.updateTournament(tournament);

    console.log(
      `[TOURNAMENT START] Starting tournament ${tournamentId} with participants:`,
      tournament.participants
    );

    const round = await this.createRound(tournament);

    this.io.emit("tournament:started", tournamentId);

    console.log(
      `[TOURNAMENT START] Notifying ${tournament.participants.length} participants about room assignment`
    );

    for (const participantId of tournament.participants) {
      console.log(`[TOURNAMENT START] Notifying participant ${participantId}`);
      this.io
        .to(`user:${participantId}`)
        .emit("tournament:participant_moved_to_room", tournamentId, round.id);
    }
  }

  async createRound(tournament: Tournament): Promise<TournamentRound> {
    const roundNumber = tournament.currentRound;

    const participants = await this.getRoundParticipants(
      tournament,
      roundNumber
    );

    const round: TournamentRound = {
      id: this.generateId(),
      tournamentId: tournament.id,
      roundNumber,
      status: RoundStatus.PENDING,
      rooms: [],
      participantIds: participants,
      startedAt: new Date(),
    };

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(round.id)
      .set(round);

    const rooms = await this.createRoomsForRound(
      tournament,
      round,
      participants
    );

    round.rooms = rooms;

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(round.id)
      .update({ rooms: rooms.map((r) => r.id) });

    await this.startRound(round.id);

    return round;
  }

  async createRoomsForRound(
    tournament: Tournament,
    round: TournamentRound,
    participants: string[]
  ): Promise<TournamentRoom[]> {
    const rooms: TournamentRoom[] = [];
    const maxPerRoom = tournament.maxParticipantsPerRoom;
    const shuffled = this.shuffleArray([...participants]);

    const existing = await this.roomManager.roomService.findRoomsWithSpace(
      round.id,
      maxPerRoom
    );

    let remaining = [...shuffled];
    let roomNumber = 1;

    for (const r of existing) {
      if (!remaining.length) break;
      const take = Math.min(
        maxPerRoom - r.participantIds.length,
        remaining.length
      );
      if (take <= 0) continue;
      const toAdd = remaining.splice(0, take);
      await this.roomManager.roomService.addParticipantsToRoom(r.id, toAdd);
      rooms.push(r);
      await this.assignParticipants(r, toAdd);
    }

    for (let i = 0; i < remaining.length; i += maxPerRoom) {
      const group = remaining.slice(i, i + maxPerRoom);

      if (group.length === 1 && rooms.length > 0) {
        const last = rooms[rooms.length - 1]!;
        await this.roomManager.roomService.addParticipantsToRoom(
          last.id,
          group
        );
        await this.assignParticipants(last, group);
        continue;
      }

      if (group.length < maxPerRoom && rooms.length > 0) {
        const last = rooms[rooms.length - 1]!;
        const currentCount = last.participantIds.length;
        const canFit = currentCount + group.length <= maxPerRoom + 1;

        if (canFit) {
          await this.roomManager.roomService.addParticipantsToRoom(
            last.id,
            group
          );
          await this.assignParticipants(last, group);
          continue;
        }
      }

      const room: TournamentRoom = {
        id: this.generateId(),
        tournamentId: tournament.id,
        roundId: round.id,
        roundNumber: round.roundNumber,
        roomNumber,

        status: "waiting" as any,

        participantIds: group,
        performanceOrder: this.shuffleArray([...group]),
        currentPerformanceIndex: 0,
        perparingTimerSeconds: tournament.perparingTimerSeconds,

        timer: {
          id: this.generateId(),
          roomId: "",
          type: "performance",
          duration: tournament.performanceTimeSeconds,
          remaining: tournament.performanceTimeSeconds,
          isRunning: false,
          isPaused: false,
        },

        votes: [],
        scores: [],
        winners: [],

        createdAt: new Date(),
      };

      room.timer.roomId = room.id;

      await this.firestore
        .collection(FIRESTORE_COLLECTIONS.ROOMS)
        .doc(room.id)
        .set(room);

      rooms.push(room);
      roomNumber++;

      this.io.emit("room:created", room);
      await this.assignParticipants(room, group);
    }

    return rooms;
  }

  private async assignParticipants(
    room: TournamentRoom,
    participantIds: string[]
  ): Promise<void> {
    for (const id of participantIds) {
      this.io.to(`user:${id}`).emit("room:assigned", room);
      await this.roomManager.joinRoom(room.id, id, `auto-${id}`);
    }
  }

  async startRound(roundId: string): Promise<void> {
    const round = await this.getRound(roundId);

    console.log("startRound", roundId);

    if (!round) {
      throw new Error("Round not found");
    }

    console.log("[TOURNAMENT STATUS] Round rooms:", round.rooms);

    round.status = RoundStatus.IN_PROGRESS;

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(roundId)
      .update({ status: RoundStatus.IN_PROGRESS });

    this.io.emit("round:started", round);
    const roomIds = round.rooms.map((r) => (typeof r === "string" ? r : r.id));

    console.log("[TOURNAMENT STATUS] Room IDs to start:", roomIds);

    for (const roomId of roomIds) {
      console.log(`[TOURNAMENT STATUS] Starting room ${roomId}`);
      this.io.to(roomId).emit("room:stage_changed", roomId, "performance");
      this.roomManager.startRoom(roomId);
    }
  }

  async restetTournamentStartAt(tournamentId: string): Promise<void> {
    const tournament = await this.getTournament(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found");
    }
    const TEN_SECONDS_IN_MILLISECONDS = 1000 * 10;
    tournament.startAt = Date.now() + TEN_SECONDS_IN_MILLISECONDS;
    tournament.status = TournamentStatus.CREATED;
    const updatedTournament = await this.updateTournament(tournament);
    return updatedTournament;
  }

  async getTournament(id: string): Promise<Tournament | null> {
    const doc = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
      .doc(id)
      .get();

    return doc.exists ? (doc.data() as Tournament) : null;
  }

  private async getRound(id: string): Promise<TournamentRound | null> {
    const doc = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(id)
      .get();

    return doc.exists ? (doc.data() as TournamentRound) : null;
  }

  private async updateTournament(tournament: Tournament): Promise<void> {
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
      .doc(tournament.id)
      .set(tournament);
  }

  private async getRoundParticipants(
    tournament: Tournament,
    roundNumber: number
  ): Promise<string[]> {
    console.log(
      `[TOURNAMENT DEBUG] Getting participants for round ${roundNumber}`
    );

    if (roundNumber === 1) {
      console.log(
        `[TOURNAMENT STATUS] Round 1 participants: ${tournament.participants.join(
          ", "
        )}`
      );
      return tournament.participants;
    }

    return [];
  }

  async startTimer(tournamentId: string): Promise<void> {
    this.stopTimer(tournamentId);

    const interval = setInterval(async () => {
      const tournament = await this.getTournament(tournamentId);

      if (!tournament) {
        console.error("Tournament not found:", tournamentId);
        this.stopTimer(tournamentId);
        return;
      }

      if (!tournament.startAt) {
        console.error("Tournament startAt is not set:", tournamentId);
        this.stopTimer(tournamentId);
        return;
      }

      const currentTime = Date.now();
      const timeLeft = Math.floor((tournament.startAt - currentTime) / 1000);

      // Emit countdown to all users in the tournament
      this.io
        .to(`tournament:${tournamentId}`)
        .emit("tournament:start:timer:tick", tournamentId, timeLeft);

      // Also emit to individual users who joined the tournament
      for (const participantId of tournament.participants) {
        this.io
          .to(`user:${participantId}`)
          .emit("tournament:countdown", tournamentId, timeLeft);
      }

      console.log(`Timer tick for ${tournamentId}: ${timeLeft}s remaining`);

      if (timeLeft <= 0) {
        console.log("Tournament timer completed");
        this.stopTimer(tournamentId);

        try {
          await this.startTournament(tournamentId);
          this.io
            .to(`tournament:${tournamentId}`)
            .emit("tournament:auto_started", tournamentId);
        } catch (error) {
          console.error("Error auto-starting tournament:", error);
        }
      }
    }, 1000);

    console.log("Tournament countdown timer started for:", tournamentId);
    this.activeTimers.set(tournamentId, interval);
  }

  stopTimer(tournamentId: string): void {
    const timer = this.activeTimers.get(tournamentId);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(tournamentId);
      console.log("Tournament timer stopped");
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = result[i];
      if (temp !== undefined && result[j] !== undefined) {
        result[i] = result[j];
        result[j] = temp;
      }
    }
    return result;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  isUserConnected(userId: string): boolean {
    return this.activeUsers.has(userId);
  }

  async handleUserDisconnection(userId: string): Promise<void> {
    console.log(`[DISCONNECTION] Handling disconnection for user ${userId}`);

    const activeRooms = await this.findUserActiveRooms(userId);

    for (const roomId of activeRooms) {
      console.log(
        `[DISCONNECTION] Removing user ${userId} from room ${roomId}`
      );

      this.io.to(roomId).emit("participant:disconnected", roomId, userId);

      await this.handleRoomParticipantDisconnection(roomId, userId);
    }
  }

  private async findUserActiveRooms(userId: string): Promise<string[]> {
    const activeRooms: string[] = [];

    const roundsSnapshot = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .where("status", "==", RoundStatus.IN_PROGRESS)
      .get();

    for (const roundDoc of roundsSnapshot.docs) {
      const round = roundDoc.data() as TournamentRound;

      for (const roomId of round.rooms.map((r) =>
        typeof r === "string" ? r : r.id
      )) {
        const room = await this.getRoom(roomId);
        if (room && room.participantIds.includes(userId)) {
          activeRooms.push(roomId);
        }
      }
    }

    return activeRooms;
  }

  private async handleRoomParticipantDisconnection(
    roomId: string,
    userId: string
  ): Promise<void> {
    const room = await this.getRoom(roomId);
    if (!room) return;

    room.participantIds = room.participantIds.filter((id) => id !== userId);

    room.performanceOrder = room.performanceOrder.filter((id) => id !== userId);

    if (room.currentPerformerId === userId) {
      const currentIndex = room.performanceOrder.findIndex(
        (id) => id === userId
      );
      if (
        currentIndex !== -1 &&
        currentIndex < room.performanceOrder.length - 1
      ) {
        const nextPerformer = room.performanceOrder[currentIndex + 1];
        if (nextPerformer) {
          room.currentPerformerId = nextPerformer;
          room.currentPerformanceIndex = currentIndex + 1;
        }
      } else {
        room.status = "completed" as any;
        room.winners = [];
      }
    }

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .doc(roomId)
      .update(room);

    if (room.participantIds.length === 0) {
      this.emit("room:completed", roomId);
    }
  }

  private async handleRoomVotingCompleted(
    roomId: string,
    roundId: string
  ): Promise<void> {
    console.log(
      `[ROUND STATUS] Room ${roomId} voting completed in round ${roundId}`
    );

    const round = await this.getRound(roundId);
    if (!round) {
      console.error(`[ROUND ERROR] Round ${roundId} not found`);
      return;
    }

    const roomIds = round.rooms.map((r) => (typeof r === "string" ? r : r.id));
    const rooms = await Promise.all(roomIds.map((id) => this.getRoom(id)));

    const allRoomsCompleted = rooms.every(
      (room) => room && room.status === "waiting_for_round_completion"
    );

    console.log(
      `[ROUND STATUS] Round ${roundId}: ${
        rooms.filter((r) => r?.status === "waiting_for_round_completion").length
      }/${roomIds.length} rooms completed voting`
    );

    if (allRoomsCompleted) {
      console.log(
        `[ROUND STATUS] All rooms in round ${roundId} completed voting`
      );
      this.io.emit("round:all_rooms_completed", roundId);

      await this.calculateRoundWinners(roundId);
    }
  }

  private async calculateRoundWinners(roundId: string): Promise<void> {
    console.log(`[ROUND STATUS] Calculating winners for round ${roundId}`);

    const round = await this.getRound(roundId);
    if (!round) {
      console.error(`[ROUND ERROR] Round ${roundId} not found`);
      return;
    }

    const roomIds = round.rooms.map((r) => (typeof r === "string" ? r : r.id));

    for (const roomId of roomIds) {
      try {
        await this.roomManager.roomService.calculateWinners(roomId);
      } catch (error) {
        console.error(
          `[ROUND ERROR] Failed to calculate winners for room ${roomId}:`,
          error
        );
      }
    }

    const updatedRooms = await Promise.all(
      roomIds.map((id) => this.getRoom(id))
    );
    const allWinnersCalculated = updatedRooms.every(
      (room) => room && room.winners.length > 0
    );

    if (allWinnersCalculated) {
      console.log(`[ROUND STATUS] All winners calculated for round ${roundId}`);

      round.status = RoundStatus.COMPLETED;
      round.completedAt = new Date();

      await this.firestore
        .collection(FIRESTORE_COLLECTIONS.ROUNDS)
        .doc(roundId)
        .update({
          status: RoundStatus.COMPLETED,
          completedAt: round.completedAt,
        });

      this.io.emit("round:completed", roundId);

      const allWinners = this.collectWinnersFromRound(updatedRooms);
      console.log(
        `[ROUND STATUS] Round ${roundId} has ${
          allWinners.length
        } winners: ${allWinners.join(", ")}`
      );

      const tournament = await this.getTournament(round.tournamentId);
      if (!tournament) return;

      const isFinalRound = updatedRooms.length === 1;

      if (isFinalRound && allWinners.length > 0) {
        const finalRoom = updatedRooms[0];
        if (finalRoom && finalRoom.scores.length > 0) {
          const topScorer = finalRoom.scores[0];
          if (topScorer) {
            const winnerId = topScorer.userId;

            console.log(
              `[TOURNAMENT STATUS] Final round completed! Winner: ${winnerId} with score ${topScorer.totalScore}`
            );

            tournament.status = TournamentStatus.COMPLETED;
            tournament.completedAt = new Date();
            tournament.winnerId = winnerId;
            await this.updateTournament(tournament);

            this.io.emit("tournament:completed", tournament.id, winnerId);
            this.io.emit("tournament:winner_announced", tournament.id, {
              winnerId,
              score: topScorer.totalScore,
              allScores: finalRoom.scores,
            });
          }
        }
      } else if (allWinners.length > 1) {
        console.log(
          `[TOURNAMENT STATUS] Advancing to next round with ${allWinners.length} winners`
        );
        await this.advanceToNextRound(tournament, allWinners);
      } else if (allWinners.length === 1 && allWinners[0]) {
        const winnerId = allWinners[0];
        console.log(
          `[TOURNAMENT STATUS] Tournament ${tournament.id} completed! Winner: ${winnerId}`
        );
        tournament.status = TournamentStatus.COMPLETED;
        tournament.completedAt = new Date();
        tournament.winnerId = winnerId;
        await this.updateTournament(tournament);
        this.io.emit("tournament:completed", tournament.id, winnerId);
      } else {
        console.log(
          `[TOURNAMENT STATUS] Stopping tournament ${tournament.id} - no winners`
        );
        this.io.emit("tournament:stopped", tournament.id);
      }
    }
  }

  private collectWinnersFromRound(rooms: (TournamentRoom | null)[]): string[] {
    const winners: string[] = [];
    for (const room of rooms) {
      if (room && room.winners) {
        winners.push(...room.winners);
      }
    }
    return winners;
  }

  private async advanceToNextRound(
    tournament: Tournament,
    winners: string[]
  ): Promise<void> {
    console.log(
      `[TOURNAMENT STATUS] Creating next round for tournament ${tournament.id}`
    );

    const eliminatedParticipants = tournament.participants.filter(
      (p) => !winners.includes(p)
    );

    await this.handleEliminatedParticipants(
      eliminatedParticipants,
      tournament.currentRound
    );

    tournament.currentRound += 1;
    tournament.participants = winners;
    await this.updateTournament(tournament);

    console.log(
      `[TOURNAMENT STATUS] Tournament ${tournament.id} advancing to round ${tournament.currentRound}`
    );
    this.io.emit(
      "tournament:round_advancing",
      tournament.id,
      tournament.currentRound
    );

    const nextRound = await this.createRoundWithParticipants(
      tournament,
      winners
    );

    console.log(
      `[TOURNAMENT STATUS] Round ${nextRound.id} created with ${winners.length} participants`
    );

    for (const participantId of winners) {
      console.log(
        `[TOURNAMENT STATUS] Notifying participant ${participantId} about next round`
      );
      this.io
        .to(`user:${participantId}`)
        .emit(
          "tournament:participant_moved_to_room",
          tournament.id,
          nextRound.id
        );
      this.io
        .to(`user:${participantId}`)
        .emit(
          "round:participant_advances",
          tournament.currentRound - 1,
          participantId,
          nextRound.id
        );
    }
  }

  private async handleEliminatedParticipants(
    eliminatedParticipants: string[],
    currentRound: number
  ): Promise<void> {
    for (const participantId of eliminatedParticipants) {
      console.log(
        `[PARTICIPANT STATUS] ${participantId} eliminated from round ${currentRound}`
      );

      const roomId = await this.roomManager.getRoomByUserId(participantId);
      if (roomId) {
        const room = await this.getRoom(roomId);
        if (room) {
          await this.roomManager.roomService.updateParticipantStatus(
            roomId,
            participantId,
            ParticipantStatus.ELIMINATED
          );

          this.io.to(roomId).emit("participant:left", roomId, participantId);

          console.log(
            `[PARTICIPANT STATUS] ${participantId} removed from room ${roomId}`
          );
        }
      }

      this.io
        .to(`user:${participantId}`)
        .emit("round:participant_eliminated", currentRound, participantId);
    }
  }

  private async createRoundWithParticipants(
    tournament: Tournament,
    participants: string[]
  ): Promise<TournamentRound> {
    const roundNumber = tournament.currentRound;

    const round: TournamentRound = {
      id: this.generateId(),
      tournamentId: tournament.id,
      roundNumber,
      status: RoundStatus.PENDING,
      rooms: [],
      participantIds: participants,
      startedAt: new Date(),
    };

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(round.id)
      .set(round);

    const rooms = await this.createRoomsForRound(
      tournament,
      round,
      participants
    );

    round.rooms = rooms;

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(round.id)
      .update({ rooms: rooms.map((r) => r.id) });

    await this.startRound(round.id);

    return round;
  }
}
