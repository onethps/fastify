import { Server as SocketServer } from "socket.io";

import { ParticipantStatus, RoomStage } from "../types/tournament.types";

import { EventEmitter } from "events";
import { TimerService } from "../services/TimerService";
import { RoomService } from "../services/RoomService";
import { PerformanceService } from "../services/PerformanceService";
import { VotingService } from "../services/VotingService";

export class RoomManager extends EventEmitter {
  private io: SocketServer;
  private firestore: any;
  private timerService: TimerService;
  public roomService: RoomService;
  private performanceService: PerformanceService;
  private votingService: VotingService;

  constructor(io: SocketServer, firestore: any) {
    super();
    this.io = io;
    this.firestore = firestore;
    this.timerService = new TimerService(io);
    this.roomService = new RoomService(io, firestore);
    this.performanceService = new PerformanceService(io, this.roomService);
    this.votingService = new VotingService(io, this.roomService);
  }

  async startRoom(roomId: string): Promise<void> {
    console.log(`[ROOM EVENT] Room ${roomId}: Starting room`);
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      console.error(`[ROOM ERROR] Room ${roomId}: Room not found in database`);
      throw new Error("Room not found");
    }

    console.log(
      `[ROOM STATUS] Room ${roomId}: Current status is ${room.status}`
    );

    if (room.status !== RoomStage.WAITING) {
      console.error(
        `[ROOM ERROR] Room ${roomId}: Cannot start room with status ${room.status}, expected ${RoomStage.WAITING}`
      );
      throw new Error("Room already started");
    }

    console.log(
      `[ROOM STATUS] Room ${roomId}: ${room.status} -> ${RoomStage.PERFORMANCE}`
    );
    room.status = RoomStage.PERFORMANCE;
    room.startedAt = new Date();

    if (room.performanceOrder.length > 0) {
      const firstPerformer = room.performanceOrder[0];
      if (firstPerformer) {
        room.currentPerformerId = firstPerformer;
      }
    }
    room.currentPerformanceIndex = 0;

    await this.roomService.updateRoom(room);

    console.log(
      `[ROOM EVENT] Room ${roomId}: Stage changed to ${RoomStage.PERFORMANCE}`
    );
    this.io
      .to(roomId)
      .emit("room:stage_changed", roomId, RoomStage.PERFORMANCE);

    const preparationTimer = await this.performanceService.startPerformance(
      roomId
    );
    await this.timerService.startTimer(roomId, preparationTimer, () =>
      this.handleTimerComplete(roomId)
    );
  }

  async pauseTimer(roomId: string): Promise<void> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    room.timer.isPaused = true;
    room.timer.isRunning = false;
    room.timer.pausedAt = new Date();

    const timerState = this.timerService.getTimerState(roomId);
    room.timer.remaining = timerState?.remaining || room.timer.remaining;

    await this.roomService.updateRoom(room);

    this.timerService.pauseTimer(roomId);
  }

  async resumeTimer(roomId: string): Promise<void> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    room.timer.isPaused = false;
    room.timer.isRunning = true;

    await this.roomService.updateRoom(room);

    await this.timerService.resumeTimer(roomId, room.timer, () =>
      this.handleTimerComplete(roomId)
    );
  }

  async handleTimerComplete(roomId: string): Promise<void> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) return;

    const activeTimer = room.preparationTimer?.isRunning
      ? room.preparationTimer
      : room.timer;

    if (!activeTimer) return;

    activeTimer.isRunning = false;
    activeTimer.completedAt = new Date();
    activeTimer.remaining = 0;

    await this.roomService.updateRoom(room);
    console.log(
      `[TIMER STATUS] Room ${roomId}: Timer completed (${activeTimer.type})`
    );
    this.io.to(roomId).emit("timer:completed", roomId);

    if (activeTimer.type === "preparation") {
      const result = await this.performanceService.handlePreparationComplete(
        roomId
      );
      if (result && result.hasNext) {
        const nextTimer = await this.performanceService.startPerformance(
          roomId
        );
        await this.timerService.startTimer(roomId, nextTimer, () =>
          this.handleTimerComplete(roomId)
        );
      } else if (result && result.shouldStartVoting) {
        const votingTimer = await this.votingService.startVoting(roomId);
        await this.timerService.startTimer(roomId, votingTimer, () =>
          this.handleTimerComplete(roomId)
        );
      }
    } else if (activeTimer.type === "performance") {
      const result = await this.performanceService.handlePerformanceComplete(
        roomId
      );
      if (result && result.hasNext) {
        const nextTimer = await this.performanceService.startPerformance(
          roomId
        );
        await this.timerService.startTimer(roomId, nextTimer, () =>
          this.handleTimerComplete(roomId)
        );
      } else if (result && result.shouldStartVoting) {
        const votingTimer = await this.votingService.startVoting(roomId);
        await this.timerService.startTimer(roomId, votingTimer, () =>
          this.handleTimerComplete(roomId)
        );
      }
    } else if (activeTimer.type === "voting") {
      await this.handleVotingTimerComplete(roomId);
    }
  }

  async submitVote(
    roomId: string,
    voterId: string,
    votes: { votedForId: string; score: number }[]
  ): Promise<boolean> {
    await this.votingService.submitVote(roomId, voterId, votes);
    return true;
  }

  async joinRoom(
    roomId: string,
    userId: string,
    socketId: string
  ): Promise<boolean> {
    console.log(
      `[ROOM EVENT] Room ${roomId}: User ${userId} attempting to join`
    );
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    if (!room.participantIds.includes(userId)) {
      throw new Error("Participant not in this room");
    }

    this.roomService.joinRoom(socketId, roomId);

    await this.roomService.updateParticipantStatus(
      roomId,
      userId,
      ParticipantStatus.ACTIVE
    );

    console.log(`[PARTICIPANT EVENT] Room ${roomId}: User ${userId} joined`);
    this.io.to(roomId).emit("participant:joined", roomId, userId);

    return true;
  }

  async leaveRoom(
    roomId: string,
    userId: string,
    socketId: string
  ): Promise<void> {
    console.log(
      `[ROOM EVENT] Room ${roomId}: User ${userId} attempting to leave`
    );
    this.roomService.leaveRoom(socketId, roomId);

    await this.roomService.updateParticipantStatus(
      roomId,
      userId,
      ParticipantStatus.OFFLINE
    );

    console.log(`[PARTICIPANT EVENT] Room ${roomId}: User ${userId} left`);
    this.io.to(roomId).emit("participant:left", roomId, userId);
  }

  async skipPreparationTimer(roomId: string): Promise<void> {
    this.timerService.stopTimer(roomId);

    const mainTimer = await this.performanceService.skipPreparationTimer(
      roomId
    );
    await this.timerService.startTimer(roomId, mainTimer, () =>
      this.handleTimerComplete(roomId)
    );
  }

  async getRoomByUserId(userId: string): Promise<string | null> {
    return await this.roomService.getRoomByUserId(userId);
  }

  async getRoom(roomId: string): Promise<any> {
    return await this.roomService.getRoom(roomId);
  }

  async handleVotingTimerComplete(roomId: string): Promise<void> {
    const room = await this.roomService.getRoom(roomId);
    if (!room) return;

    const tournament = await this.roomService.getTournament(room.tournamentId);
    if (!tournament) return;

    await this.autoVoteForNonVoters(room);

    console.log(`[VOTING COMPLETE] Room ${roomId}: Voting timer completed`);
    this.io.to(roomId).emit("voting:completed", roomId);

    console.log(
      `[ROOM STATUS] Room ${roomId}: ${room.status} -> ${RoomStage.WAITING_FOR_ROUND_COMPLETION}`
    );
    room.status = RoomStage.WAITING_FOR_ROUND_COMPLETION;
    await this.roomService.updateRoom(room);

    for (const participantId of room.participantIds) {
      await this.roomService.updateParticipantStatus(
        roomId,
        participantId,
        ParticipantStatus.WAITING_FOR_ROUND_COMPLETION
      );
    }

    console.log(
      `[ROOM EVENT] Room ${roomId}: Stage changed to ${RoomStage.WAITING_FOR_ROUND_COMPLETION}`
    );
    this.io
      .to(roomId)
      .emit(
        "room:stage_changed",
        roomId,
        RoomStage.WAITING_FOR_ROUND_COMPLETION
      );
    this.io.to(roomId).emit("room:waiting_for_completion", roomId);

    this.emit("room:voting_completed", roomId, room.roundId);
  }

  private async autoVoteForNonVoters(room: any): Promise<void> {
    const votedParticipants = new Set(room.votes.map((v: any) => v.voterId));
    const nonVoters = room.participantIds.filter(
      (id: string) => !votedParticipants.has(id)
    );

    if (nonVoters.length === 0) {
      console.log(`[AUTO-VOTE] Room ${room.id}: All participants voted`);
      return;
    }

    console.log(
      `[AUTO-VOTE] Room ${room.id}: Auto-voting for ${nonVoters.length} participants`
    );

    for (const voterId of nonVoters) {
      const otherParticipants = room.participantIds.filter(
        (id: string) => id !== voterId
      );

      for (const votedForId of otherParticipants) {
        const autoScore = Math.floor(Math.random() * 3) + 3;

        const voteRecord = {
          id: this.roomService.generateId(),
          roomId: room.id,
          roundId: room.roundId,
          voterId,
          votedForId,
          score: autoScore,
          createdAt: new Date(),
          isAutoVote: true,
        };

        room.votes.push(voteRecord);
        await this.roomService.saveVote(voteRecord);
      }

      console.log(
        `[AUTO-VOTE] Room ${room.id}: Created auto-vote for participant ${voterId}`
      );
    }

    await this.roomService.updateRoom(room);
  }

  cleanup(): void {
    this.timerService.cleanup();
  }
}
