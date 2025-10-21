/**
 * Tournament Manager - управління турнірами
 */

import { Server as SocketServer } from "socket.io";
import { EventEmitter } from "events";
import {
  Tournament,
  TournamentStatus,
  TournamentRound,
  RoundStatus,
  TournamentRoom,
  FIRESTORE_COLLECTIONS,
} from "../types/tournament.types";
import { RoomManager } from "./RoomManager";

export class TournamentManager extends EventEmitter {
  private io: SocketServer;
  private firestore: any;
  private roomManager: RoomManager;
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private connectedUsers: Set<string> = new Set();

  constructor(io: SocketServer, firestore: any) {
    super();
    this.io = io;
    this.firestore = firestore;
    this.roomManager = new RoomManager(io, firestore);

    this.roomManager.on("room:completed", (roomId: string) => {
      console.log("🎧 Listen  ROOM COMPLETED", roomId);
      this.handleRoomCompleted(roomId);
    });
  }

  /**
   * Handle room completion - called by RoomManager
   */
  async handleRoomCompleted(roomId: string): Promise<void> {
    console.log(`[TOURNAMENT STATUS] Room ${roomId} completed`);

    // Get the room to find its round
    const room = await this.getRoom(roomId);
    if (!room) {
      console.error(`[TOURNAMENT STATUS] Room ${roomId} not found`);
      return;
    }

    // Check if all rooms in the round are completed
    const round = await this.getRound(room.roundId);
    if (!round) {
      console.error(`[TOURNAMENT STATUS] Round ${room.roundId} not found`);
      return;
    }

    // Notify all participants in this room that they need to wait for round completion
    for (const participantId of room.participantIds) {
      this.io.emit("round:waiting_for_completion", round.id, participantId);

      // Update participant status to waiting
      this.io.emit(
        "participant:status_changed",
        roomId,
        participantId,
        "waiting_for_round_completion"
      );
    }

    // Check if all rooms in this round are completed
    const allRoomsCompleted = await this.checkAllRoomsCompleted(round.id);

    if (allRoomsCompleted) {
      console.log(
        `[TOURNAMENT STATUS] All rooms in round ${round.id} completed`
      );
      await this.completeRound(round.id);
    }
  }

  /**
   * Check if all rooms in a round are completed and have winners
   */
  private async checkAllRoomsCompleted(roundId: string): Promise<boolean> {
    const round = await this.getRound(roundId);
    if (!round) return false;

    for (const roomId of round.rooms.map((r) =>
      typeof r === "string" ? r : r.id
    )) {
      const room = await this.getRoom(roomId);
      if (!room || room.status !== "completed") {
        console.log(`[TOURNAMENT STATUS] Room ${roomId} not completed yet`);
        return false;
      }

      // Check if room has winners
      if (!room.winners || room.winners.length === 0) {
        console.log(
          `[TOURNAMENT STATUS] Room ${roomId} completed but has no winners`
        );
        return false;
      }
    }

    console.log(
      `[TOURNAMENT STATUS] All rooms in round ${roundId} completed with winners`
    );
    return true;
  }

  /**
   * Get room by ID
   */
  private async getRoom(id: string): Promise<TournamentRoom | null> {
    const doc = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .doc(id)
      .get();

    return doc.exists ? (doc.data() as TournamentRoom) : null;
  }

  /**
   * Створення нового турніру
   */
  async createTournament(data: {
    name: string;
    description?: string;
    createdBy: string;
    maxParticipantsPerRoom?: number;
    performanceTimeSeconds?: number;
    votingTimeSeconds?: number;
    advancePerRoom?: number;
    startAt?: number; // Unix timestamp в секундах
  }): Promise<Tournament> {
    const tournament: Tournament = {
      id: this.generateId(),
      name: data.name,
      ...(data.description && { description: data.description }),
      status: TournamentStatus.CREATED,

      maxParticipantsPerRoom: data.maxParticipantsPerRoom || 5,
      performanceTimeSeconds: data.performanceTimeSeconds || 60,
      votingTimeSeconds: data.votingTimeSeconds || 60,
      advancePerRoom: data.advancePerRoom || 2, // 2 з 5 проходять далі

      currentRound: 0,
      totalRounds: 0, // розрахується після реєстрації
      participants: [],

      createdBy: data.createdBy,
      createdAt: new Date(),
      ...(data.startAt && { startAt: data.startAt }),
    };

    // Зберігаємо в Firestore
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
      .doc(tournament.id)
      .set(tournament);

    // Broadcast подію
    this.io.emit("tournament:created", tournament);

    console.log(
      `[TOURNAMENT STATUS] Tournament created: ${tournament.id} by ${data.createdBy}`
    );
    return tournament;
  }

  /**
   * Реєстрація учасника в турнірі
   */
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

    // Перевірка чи учасник вже зареєстрований
    if (tournament.participants.includes(userId)) {
      return false;
    }

    // Додаємо учасника
    tournament.participants.push(userId);
    tournament.status = TournamentStatus.REGISTRATION;

    // Оновлюємо в базі
    await this.updateTournament(tournament);

    console.log(
      `[TOURNAMENT STATUS] User ${userId} registered for tournament ${tournamentId}`
    );

    // Broadcast подію
    this.io.emit("tournament:participant_registered", tournamentId, userId);

    return true;
  }

  /**
   * Початок турніру
   */
  async startTournament(tournamentId: string): Promise<void> {
    console.log("startTournament");

    const tournament = await this.getTournament(tournamentId);

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    if (tournament.status === TournamentStatus.IN_PROGRESS) {
      throw new Error("Tournament already started");
    }

    // Get only connected participants
    const connectedParticipants = await this.getConnectedUsersForTournament(
      tournamentId
    );

    if (connectedParticipants.length < 2) {
      throw new Error("Not enough connected participants");
    }

    // Update tournament participants to only include connected users
    tournament.participants = connectedParticipants;

    tournament.status = TournamentStatus.IN_PROGRESS;
    tournament.currentRound = 1;
    tournament.startedAt = new Date();
    tournament.id = tournamentId;

    await this.updateTournament(tournament);

    // Створюємо перший раунд
    await this.createRound(tournament);

    this.io.emit("tournament:started", tournamentId);
  }

  // async prepareTournament(tournamentId: string): Promise<void> {
  //   const tournament = await this.getTournament(tournamentId);
  //   if (!tournament) {
  //     throw new Error("Tournament not found");
  //   }

  //   tournament.status = TournamentStatus.PREPARING;
  //   await this.updateTournament(tournament);

  //   this.io.emit("tournament:preparing", tournamentId);
  // }

  /**
   * Створення раунду
   */
  async createRound(tournament: Tournament): Promise<TournamentRound> {
    const roundNumber = tournament.currentRound;

    // Отримуємо учасників для цього раунду
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

    // Зберігаємо раунд
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(round.id)
      .set(round);

    // Створюємо кімнати для раунду
    const rooms = await this.createRoomsForRound(
      tournament,
      round,
      participants
    );

    round.rooms = rooms;

    // Оновлюємо раунд з кімнатами
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(round.id)
      .update({ rooms: rooms.map((r) => r.id) });

    // Запускаємо раунд
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

    console.log("createRoomsForRound");

    // Перемішуємо учасників для рандомного розподілу
    const shuffled = this.shuffleArray([...participants]);

    // Розбиваємо на групи
    let roomNumber = 1;
    for (let i = 0; i < shuffled.length; i += maxPerRoom) {
      const roomParticipants = shuffled.slice(i, i + maxPerRoom);

      console.log("roomParticipants");

      const room: TournamentRoom = {
        id: this.generateId(),
        tournamentId: tournament.id,
        roundId: round.id,
        roundNumber: round.roundNumber,
        roomNumber,

        status: "waiting" as any,

        participantIds: roomParticipants,
        performanceOrder: this.shuffleArray([...roomParticipants]),
        currentPerformanceIndex: 0,

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

      // Зберігаємо кімнату
      await this.firestore
        .collection(FIRESTORE_COLLECTIONS.ROOMS)
        .doc(room.id)
        .set(room);

      rooms.push(room);
      roomNumber++;

      // Broadcast подію про створення кімнати
      this.io.emit("room:created", room);
    }

    console.log("after createRoomsForRound");

    return rooms;
  }

  /**
   * Запуск раунду - всі кімнати починають одночасно
   */
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

    // Запускаємо всі кімнати
    const roomIds = round.rooms.map((r) => (typeof r === "string" ? r : r.id));

    console.log("[TOURNAMENT STATUS] Room IDs to start:", roomIds);

    for (const roomId of roomIds) {
      console.log(`[TOURNAMENT STATUS] Starting room ${roomId}`);
      // RoomManager буде обробляти це
      this.io.to(roomId).emit("room:stage_changed", roomId, "performance");
      this.roomManager.startRoom(roomId);
    }
  }

  /**
   * Завершення раунду та перехід до наступного
   */
  async completeRound(roundId: string): Promise<void> {
    console.log(`[TOURNAMENT STATUS] Completing round ${roundId}`);

    const round = await this.getRound(roundId);

    if (!round) {
      throw new Error("Round not found");
    }

    round.status = RoundStatus.COMPLETED;
    round.completedAt = new Date();

    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .doc(roundId)
      .update({
        status: RoundStatus.COMPLETED,
        completedAt: round.completedAt,
      });

    console.log(`[TOURNAMENT STATUS] Round ${roundId} marked as completed`);
    this.io.emit("round:completed", roundId);
    this.io.emit("round:all_rooms_completed", roundId);

    // Отримуємо переможців з усіх кімнат
    const winners = await this.getRoundWinners(roundId);
    console.log(
      `[TOURNAMENT STATUS] Round ${roundId} winners: ${winners.join(", ")}`
    );

    const tournament = await this.getTournament(round.tournamentId);

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    // Notify all participants about their status
    await this.notifyParticipantsOfRoundCompletion(round, winners);

    // Перевіряємо чи це був фінальний раунд
    if (winners.length <= 1) {
      // Tournament completed
      if (winners.length === 1 && winners[0]) {
        await this.completeTournament(tournament.id, winners[0]);
      } else {
        // No winners - tournament cancelled
        tournament.status = TournamentStatus.CANCELLED;
        await this.updateTournament(tournament);
        this.io.emit("tournament:cancelled", tournament.id);
      }
      return;
    }

    // Переходимо до наступного раунду
    console.log(
      `[TOURNAMENT STATUS] Creating next round for tournament ${tournament.id}`
    );
    tournament.currentRound++;
    await this.updateTournament(tournament);

    // Small delay to ensure all room data is fully persisted
    await new Promise((resolve) => setTimeout(resolve, 100));

    const nextRound = await this.createRound(tournament);

    // Notify all participants that the next round is ready
    console.log(`[ROUND STATUS] Next round ${nextRound.id} is ready`);
    this.io.emit("round:next_ready", roundId, nextRound.id);

    // Notify winners about advancing to next round
    for (const winnerId of winners) {
      this.io.emit(
        "round:participant_advances",
        roundId,
        winnerId,
        nextRound.id
      );
    }
  }

  /**
   * Notify all participants about round completion status
   */
  private async notifyParticipantsOfRoundCompletion(
    round: TournamentRound,
    winners: string[]
  ): Promise<void> {
    const winnerSet = new Set(winners);

    // Get all participants from all rooms in this round
    const allParticipants = new Set<string>();
    for (const roomId of round.rooms.map((r) =>
      typeof r === "string" ? r : r.id
    )) {
      const room = await this.getRoom(roomId);
      if (room) {
        room.participantIds.forEach((id) => allParticipants.add(id));
      }
    }

    // Notify each participant about their status
    for (const participantId of allParticipants) {
      if (winnerSet.has(participantId)) {
        // Winner - will advance to next round
        this.io.emit(
          "round:participant_advances",
          round.id,
          participantId,
          "next_round"
        );
      } else {
        // Eliminated
        this.io.emit("round:participant_eliminated", round.id, participantId);
      }
    }
  }

  /**
   * Завершення турніру
   */
  async completeTournament(
    tournamentId: string,
    winnerId: string
  ): Promise<void> {
    console.log(
      `[TOURNAMENT STATUS] Completing tournament ${tournamentId} with winner ${winnerId}`
    );

    const tournament = await this.getTournament(tournamentId);

    if (!tournament) {
      throw new Error("Tournament not found");
    }

    tournament.status = TournamentStatus.COMPLETED;
    tournament.winnerId = winnerId;
    tournament.completedAt = new Date();

    await this.updateTournament(tournament);

    console.log(
      `[TOURNAMENT STATUS] Tournament ${tournamentId} completed successfully`
    );
    this.io.emit("tournament:completed", tournamentId, winnerId);
  }

  // ============================================
  // Helper methods
  // ============================================

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

  private async getRoundByNumber(
    tournamentId: string,
    roundNumber: number
  ): Promise<TournamentRound | null> {
    const querySnapshot = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .where("tournamentId", "==", tournamentId)
      .where("roundNumber", "==", roundNumber)
      .get();

    if (querySnapshot.empty) {
      return null;
    }

    return querySnapshot.docs[0].data() as TournamentRound;
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

    // Для наступних раундів отримуємо переможців попереднього раунду
    console.log(
      `[TOURNAMENT STATUS] Getting participants for round ${roundNumber}`
    );

    // Отримуємо попередній раунд
    const previousRound = await this.getRoundByNumber(
      tournament.id,
      roundNumber - 1
    );
    if (!previousRound) {
      console.error(
        `[TOURNAMENT STATUS] Previous round ${roundNumber - 1} not found`
      );
      return [];
    }

    // Отримуємо переможців з попереднього раунду
    console.log(
      `[TOURNAMENT DEBUG] Getting winners from previous round ${previousRound.id}`
    );
    const winners = await this.getRoundWinners(previousRound.id);
    console.log(
      `[TOURNAMENT STATUS] Round ${roundNumber} participants (winners from round ${
        roundNumber - 1
      }): ${winners.join(", ")}`
    );

    if (winners.length === 0) {
      console.error(
        `[TOURNAMENT ERROR] No winners found for round ${
          roundNumber - 1
        }, cannot create round ${roundNumber}`
      );
    }

    return winners;
  }

  private async getRoundWinners(roundId: string): Promise<string[]> {
    // Отримуємо переможців з усіх кімнат раунду
    const round = await this.getRound(roundId);
    if (!round) {
      console.error(
        `[TOURNAMENT ERROR] Round ${roundId} not found when getting winners`
      );
      return [];
    }

    console.log(
      `[TOURNAMENT DEBUG] Getting winners for round ${roundId}, rooms:`,
      round.rooms
    );

    const winners: string[] = [];

    for (const roomId of round.rooms.map((r) =>
      typeof r === "string" ? r : r.id
    )) {
      const room = await this.getRoom(roomId);
      if (room) {
        console.log(
          `[TOURNAMENT DEBUG] Room ${roomId} status: ${room.status}, winners:`,
          room.winners
        );
        if (room.winners && room.winners.length > 0) {
          winners.push(...room.winners);
        } else {
          console.warn(
            `[TOURNAMENT WARNING] Room ${roomId} has no winners despite being completed`
          );
        }
      } else {
        console.error(
          `[TOURNAMENT ERROR] Room ${roomId} not found when getting winners`
        );
      }
    }

    console.log(
      `[TOURNAMENT DEBUG] Total winners for round ${roundId}:`,
      winners
    );
    return winners;
  }

  async startTimer(tournamentId: string): Promise<void> {
    // Очищаємо попередній таймер якщо він існує
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

      // Обчислюємо залишок часу до початку турніру
      // startAt зберігається у секундах (Unix timestamp)
      const nowInSeconds = Math.floor(Date.now() / 1000);

      //ff
      const FIVE_MINUTES_IN_SECONDS = 10 * 20; // 20 minutes
      const timeLeft = Math.max(
        0,
        tournament.startAt + FIVE_MINUTES_IN_SECONDS - nowInSeconds
      );

      // Broadcast тік таймера з часом у секундах
      this.io
        .to(`tournament:${tournamentId}`)
        .emit("tournament:start:timer:tick", tournamentId, timeLeft);

      console.log(`Timer tick for ${tournamentId}: ${timeLeft}s remaining`);

      // Перевірка завершення
      if (timeLeft <= 0) {
        console.log("Tournament timer completed");
        this.stopTimer(tournamentId);

        // Автоматично запускаємо турнір
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

  /**
   * Зупинка таймера турніру
   */
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

  /**
   * Add connected user
   */
  addConnectedUser(userId: string): void {
    this.connectedUsers.add(userId);
    console.log(
      `[CONNECTION] User ${userId} connected. Total connected: ${this.connectedUsers.size}`
    );
  }

  /**
   * Remove disconnected user
   */
  removeConnectedUser(userId: string): void {
    this.connectedUsers.delete(userId);
    console.log(
      `[CONNECTION] User ${userId} disconnected. Total connected: ${this.connectedUsers.size}`
    );
  }

  /**
   * Get connected users for a tournament
   */
  async getConnectedUsersForTournament(
    tournamentId: string
  ): Promise<string[]> {
    const tournament = await this.getTournament(tournamentId);
    if (!tournament) return [];

    // Return only participants who are currently connected
    return tournament.participants.filter((participantId) =>
      this.connectedUsers.has(participantId)
    );
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * Handle user disconnection during tournament
   */
  async handleUserDisconnection(userId: string): Promise<void> {
    console.log(`[DISCONNECTION] Handling disconnection for user ${userId}`);

    // Find all active rooms where this user is participating
    const activeRooms = await this.findUserActiveRooms(userId);

    for (const roomId of activeRooms) {
      console.log(
        `[DISCONNECTION] Removing user ${userId} from room ${roomId}`
      );

      // Notify room participants about the disconnection
      this.io.to(roomId).emit("participant:disconnected", roomId, userId);

      // Update room status if needed
      await this.handleRoomParticipantDisconnection(roomId, userId);
    }
  }

  /**
   * Find all active rooms where user is participating
   */
  private async findUserActiveRooms(userId: string): Promise<string[]> {
    const activeRooms: string[] = [];

    // Query all active rounds
    const roundsSnapshot = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROUNDS)
      .where("status", "==", RoundStatus.IN_PROGRESS)
      .get();

    for (const roundDoc of roundsSnapshot.docs) {
      const round = roundDoc.data() as TournamentRound;

      // Check each room in the round
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

  /**
   * Handle participant disconnection in a specific room
   */
  private async handleRoomParticipantDisconnection(
    roomId: string,
    userId: string
  ): Promise<void> {
    const room = await this.getRoom(roomId);
    if (!room) return;

    // Remove user from participant list
    room.participantIds = room.participantIds.filter((id) => id !== userId);

    // Remove from performance order
    room.performanceOrder = room.performanceOrder.filter((id) => id !== userId);

    // Update current performer if needed
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
        // No more performers, end the room
        room.status = "completed" as any;
        room.winners = [];
      }
    }

    // Update room in database
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .doc(roomId)
      .update(room);

    // If room has no more participants, mark it as completed
    if (room.participantIds.length === 0) {
      this.emit("room:completed", roomId);
    }
  }
}
