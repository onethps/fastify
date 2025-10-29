import { Server as SocketServer } from "socket.io";
import {
  ParticipantStatus,
  RoomStage,
  TournamentRoom,
  VoteRecord,
  RoomTimer,
} from "../types/tournament.types";
import { RoomService } from "./RoomService";

export class VotingService {
  private io: SocketServer;
  private roomService: RoomService;

  constructor(io: SocketServer, roomService: RoomService) {
    this.io = io;
    this.roomService = roomService;
  }

  async startVoting(roomId: string): Promise<RoomTimer> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) throw new Error("Room not found");

    // Get tournament to access votingTimeSeconds
    const tournament = await this.roomService.getTournament(room.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    console.log(
      `[ROOM STATUS] Room ${roomId}: ${room.status} -> ${RoomStage.VOTING}`
    );
    room.status = RoomStage.VOTING;

    room.timer = {
      id: this.roomService.generateId(),
      roomId: room.id,
      type: "voting",
      duration: tournament.votingTimeSeconds,
      remaining: tournament.votingTimeSeconds,
      isRunning: true,
      isPaused: false,
      startedAt: new Date(),
    };

    await this.roomService.updateRoom(room);

    for (const participantId of room.participantIds) {
      await this.roomService.updateParticipantStatus(
        roomId,
        participantId,
        ParticipantStatus.VOTING
      );
    }

    console.log(
      `[ROOM EVENT] Room ${roomId}: Stage changed to ${RoomStage.VOTING}`
    );
    this.io.to(roomId).emit("room:stage_changed", roomId, RoomStage.VOTING);
    console.log(`[VOTING STATUS] Room ${roomId}: Voting started`);
    this.io.to(roomId).emit("voting:started", roomId);
    console.log(
      `[TIMER STATUS] Room ${roomId}: Timer started for voting (${room.timer.remaining}s)`
    );
    this.io.to(roomId).emit("timer:started", roomId, room.timer);

    return room.timer;
  }

  async submitVote(
    roomId: string,
    voterId: string,
    votes: { votedForId: string; score: number }[]
  ): Promise<{ allVoted: boolean }> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) {
      throw new Error("Room not found");
    }

    if (room.status !== RoomStage.VOTING) {
      throw new Error("Voting is not active");
    }

    if (!room.participantIds.includes(voterId)) {
      throw new Error("You are not a participant in this room");
    }

    if (votes.some((v) => v.votedForId === voterId)) {
      throw new Error("Cannot vote for yourself");
    }

    for (const vote of votes) {
      if (!room.participantIds.includes(vote.votedForId)) {
        throw new Error(`Participant ${vote.votedForId} is not in this room`);
      }
    }

    for (const vote of votes) {
      const voteRecord: VoteRecord = {
        id: this.roomService.generateId(),
        roomId: room.id,
        roundId: room.roundId,
        voterId,
        votedForId: vote.votedForId,
        score: vote.score,
        createdAt: new Date(),
      };

      room.votes.push(voteRecord);

      await this.roomService.saveVote(voteRecord);
    }

    await this.roomService.updateRoom(room);

    console.log(
      `[VOTING STATUS] Room ${roomId}: Vote received from user ${voterId}`
    );
    this.io.to(roomId).emit("voting:received", roomId, voterId);

    const allVoted = await this.checkAllVoted(room);

    return { allVoted };
  }

  async checkAllVoted(room: TournamentRoom): Promise<boolean> {
    const votedParticipants = new Set(room.votes.map((v) => v.voterId));
    return votedParticipants.size === room.participantIds.length;
  }
}
