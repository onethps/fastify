import { Server as SocketServer } from "socket.io";
import { ParticipantStatus, RoomTimer } from "../types/tournament.types";
import { RoomService } from "./RoomService";

export class PerformanceService {
  private io: SocketServer;
  private roomService: RoomService;

  constructor(io: SocketServer, roomService: RoomService) {
    this.io = io;
    this.roomService = roomService;
  }

  async startPerformance(roomId: string): Promise<RoomTimer> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    const performerId = room.currentPerformerId;

    if (!performerId) {
      throw new Error("No performer set");
    }

    await this.roomService.updateParticipantStatus(
      roomId,
      performerId,
      ParticipantStatus.PERFORMING
    );

    room.preparationTimer = {
      id: this.roomService.generateId(),
      roomId: room.id,
      type: "preparation",
      duration: 10,
      remaining: 10,
      isRunning: true,
      isPaused: false,
      startedAt: new Date(),
    };

    await this.roomService.updateRoom(room);

    console.log(
      `[PERFORMANCE STATUS] Room ${roomId}: Preparation started for user ${performerId}`
    );
    this.io
      .to(roomId)
      .emit("performance:preparation_started", roomId, performerId);
    console.log(
      `[TIMER STATUS] Room ${roomId}: Preparation timer started (${room.preparationTimer.remaining}s)`
    );
    this.io.to(roomId).emit("timer:started", roomId, room.preparationTimer);

    return room.preparationTimer;
  }

  async startMainPerformance(roomId: string): Promise<RoomTimer> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    const performerId = room.currentPerformerId;

    if (!performerId) {
      throw new Error("No performer set");
    }

    room.timer = {
      id: this.roomService.generateId(),
      roomId: room.id,
      type: "performance",
      duration: room.timer.duration,
      remaining: room.timer.duration,
      isRunning: true,
      isPaused: false,
      startedAt: new Date(),
    };

    await this.roomService.updateRoom(room);

    console.log(
      `[PERFORMANCE STATUS] Room ${roomId}: Main performance started for user ${performerId}`
    );
    this.io.to(roomId).emit("performance:started", roomId, performerId);
    console.log(
      `[TIMER STATUS] Room ${roomId}: Timer started for performance (${room.timer.remaining}s)`
    );
    this.io.to(roomId).emit("timer:started", roomId, room.timer);

    return room.timer;
  }

  async handlePerformanceComplete(roomId: string): Promise<{
    hasNext: boolean;
    nextPerformerId?: string | undefined;
    shouldStartVoting?: boolean;
  }> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) return { hasNext: false, shouldStartVoting: false };

    const performerId = room.currentPerformerId!;

    console.log({
      performerId,
    });

    await this.roomService.updateParticipantStatus(
      roomId,
      performerId,
      ParticipantStatus.ACTIVE
    );

    console.log(
      `[PERFORMANCE STATUS] Room ${roomId}: Performance completed for user ${performerId}`
    );
    this.io.to(roomId).emit("performance:completed", roomId, performerId);

    room.currentPerformanceIndex++;

    console.log({
      currentPerformanceIndex: room.currentPerformanceIndex,
      performanceOrderLength: room.performanceOrder.length,
    });

    if (room.currentPerformanceIndex < room.performanceOrder.length) {
      const nextPerformerId =
        room.performanceOrder[room.currentPerformanceIndex];
      if (nextPerformerId) {
        room.currentPerformerId = nextPerformerId;
      }

      await this.roomService.updateRoom(room);

      console.log(
        `[PERFORMANCE STATUS] Room ${roomId}: Next performer ${room.currentPerformerId}`
      );
      this.io
        .to(roomId)
        .emit("performance:next", roomId, room.currentPerformerId);

      return { hasNext: true, nextPerformerId: room.currentPerformerId };
    } else {
      return { hasNext: false, shouldStartVoting: true };
    }
  }

  async handlePreparationComplete(roomId: string): Promise<{
    hasNext: boolean;
    nextPerformerId?: string | undefined;
    shouldStartVoting?: boolean;
  }> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) return { hasNext: false, shouldStartVoting: false };

    const performerId = room.currentPerformerId!;

    console.log(
      `[PERFORMANCE STATUS] Room ${roomId}: Preparation completed for user ${performerId} - moving to next participant`
    );
    this.io
      .to(roomId)
      .emit("performance:preparation_completed", roomId, performerId);

    delete room.preparationTimer;
    await this.roomService.updateRoom(room);

    return this.handlePerformanceComplete(roomId);
  }

  async skipPreparationTimer(roomId: string): Promise<RoomTimer> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    if (!room.preparationTimer || !room.preparationTimer.isRunning) {
      throw new Error("No active preparation timer to skip");
    }

    console.log(
      `[PERFORMANCE STATUS] Room ${roomId}: Preparation timer skipped for user ${room.currentPerformerId} - starting main performance`
    );

    delete room.preparationTimer;
    await this.roomService.updateRoom(room);

    return this.startMainPerformance(roomId);
  }
}
