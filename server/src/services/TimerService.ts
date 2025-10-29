import { Server as SocketServer } from "socket.io";
import { RoomTimer } from "../types/tournament.types";

export class TimerService {
  private io: SocketServer;

  private activeTimers: Map<string, NodeJS.Timeout> = new Map();

  private timerStates: Map<string, { remaining: number; isRunning: boolean }> =
    new Map();

  constructor(io: SocketServer) {
    this.io = io;
  }

  async startTimer(
    roomId: string,
    timer: RoomTimer,
    onComplete: () => Promise<void>
  ): Promise<void> {
    console.log(
      `[TIMER START] Starting timer for room ${roomId} with ${timer.remaining}s`
    );

    this.stopTimer(roomId);

    this.timerStates.set(roomId, {
      remaining: timer.remaining,
      isRunning: true,
    });

    const interval = setInterval(async () => {
      const timerState = this.timerStates.get(roomId);
      if (!timerState || !timerState.isRunning) {
        console.log("Stopping timer for room:", roomId);
        this.stopTimer(roomId);
        return;
      }

      timerState.remaining--;

      if (timerState.remaining > 0) {
        this.io.to(roomId).emit("timer:tick", roomId, timerState.remaining);

        console.log(
          `[TIMER STATUS] Room ${roomId}: Timer tick - ${timerState.remaining}s remaining`
        );
      } else {
        this.stopTimer(roomId);
        await onComplete();
      }
    }, 1000);

    this.activeTimers.set(roomId, interval);
  }

  stopTimer(roomId: string): void {
    const timer = this.activeTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(roomId);
      console.log(`[TIMER STOP] Timer interval cleared for room: ${roomId}`);
    } else {
      console.log(`[TIMER STOP] No active timer found for room: ${roomId}`);
    }

    if (this.timerStates.has(roomId)) {
      this.timerStates.delete(roomId);
      console.log(`[TIMER STOP] Timer state cleared for room: ${roomId}`);
    }

    this.io.to(roomId).emit("timer:stopped", roomId);
  }

  pauseTimer(roomId: string): void {
    const timerState = this.timerStates.get(roomId);

    if (timerState) {
      timerState.isRunning = false;
    }

    this.stopTimer(roomId);

    console.log(`[TIMER STATUS] Room ${roomId}: Timer paused`);
    this.io.to(roomId).emit("timer:paused", roomId);
  }

  async resumeTimer(
    roomId: string,
    timer: RoomTimer,
    onComplete: () => Promise<void>
  ): Promise<void> {
    console.log(`[TIMER STATUS] Room ${roomId}: Timer resumed`);
    this.io.to(roomId).emit("timer:resumed", roomId);

    await this.startTimer(roomId, timer, onComplete);
  }

  getTimerState(
    roomId: string
  ): { remaining: number; isRunning: boolean } | null {
    return this.timerStates.get(roomId) || null;
  }

  isTimerActive(roomId: string): boolean {
    return this.activeTimers.has(roomId);
  }

  cleanup(): void {
    this.activeTimers.forEach((timer) => {
      clearInterval(timer);
    });
    this.activeTimers.clear();
    this.timerStates.clear();
  }
}
