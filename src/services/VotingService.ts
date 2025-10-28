import { Server as SocketServer } from "socket.io";
import {
  ParticipantStatus,
  RoomStage,
  TournamentRoom,
  VoteRecord,
  ParticipantScore,
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

    if (votes.some((v) => v.votedForId === voterId)) {
      throw new Error("Cannot vote for yourself");
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

  async handleVotingComplete(
    roomId: string
  ): Promise<{ scores: ParticipantScore[]; winners: string[] }> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) return { scores: [], winners: [] };

    console.log(
      `[ROOM STATUS] Room ${roomId}: ${room.status} -> ${RoomStage.RESULTS}`
    );
    room.status = RoomStage.RESULTS;

    await this.roomService.updateRoom(room);

    this.io.to(roomId).emit("voting:completed", roomId);

    const result = await this.calculateResults(roomId);

    return result;
  }

  async autoScoreMissingVotes(roomId: string): Promise<void> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) return;

    const votedParticipants = new Set(room.votes.map((v) => v.voterId));

    const nonVotingParticipants = room.participantIds.filter(
      (participantId) => !votedParticipants.has(participantId)
    );

    console.log(
      `[AUTO SCORE] Room ${roomId}: Found ${nonVotingParticipants.length} participants without votes`
    );

    for (const voterId of nonVotingParticipants) {
      const otherParticipants = room.participantIds.filter(
        (participantId) => participantId !== voterId
      );

      for (const votedForId of otherParticipants) {
        const randomScore = Math.floor(Math.random() * 5) + 1;

        const voteRecord: VoteRecord = {
          id: this.roomService.generateId(),
          roomId: room.id,
          roundId: room.roundId,
          voterId,
          votedForId,
          score: randomScore,
          createdAt: new Date(),
        };

        room.votes.push(voteRecord);

        await this.roomService.saveVote(voteRecord);

        console.log(
          `[AUTO SCORE] Room ${roomId}: Auto-scored ${voterId} -> ${votedForId}: ${randomScore}`
        );
      }
    }

    await this.roomService.updateRoom(room);

    if (nonVotingParticipants.length > 0) {
      console.log(
        `[AUTO SCORE] Room ${roomId}: Auto-scoring completed for ${nonVotingParticipants.length} participants`
      );
      this.io
        .to(roomId)
        .emit("voting:auto_scored", roomId, nonVotingParticipants);
    }
  }

  async calculateResults(
    roomId: string
  ): Promise<{ scores: ParticipantScore[]; winners: string[] }> {
    const room = await this.roomService.getRoom(roomId);

    if (!room) return { scores: [], winners: [] };

    const scoreMap = new Map<string, { total: number; count: number }>();

    for (const vote of room.votes) {
      const current = scoreMap.get(vote.votedForId) || { total: 0, count: 0 };
      current.total += vote.score;
      current.count++;
      scoreMap.set(vote.votedForId, current);
    }

    const scores: ParticipantScore[] = [];

    for (const [userId, data] of Array.from(scoreMap.entries())) {
      scores.push({
        userId,
        roomId: room.id,
        roundNumber: room.roundNumber,
        totalScore: data.total,
        voteCount: data.count,
        averageScore: data.count > 0 ? data.total / data.count : 0,
        rank: 0,
        advancesToNextRound: false,
      });
    }

    for (const participantId of room.participantIds) {
      if (!scoreMap.has(participantId)) {
        scores.push({
          userId: participantId,
          roomId: room.id,
          roundNumber: room.roundNumber,
          totalScore: 0,
          voteCount: 0,
          averageScore: 0,
          rank: 0,
          advancesToNextRound: false,
        });
      }
    }

    scores.sort((a, b) => b.averageScore - a.averageScore);

    scores.forEach((score, index) => {
      score.rank = index + 1;
    });

    const tournament = await this.roomService.getTournament(room.tournamentId);
    const advanceCount = tournament?.advancePerRoom || 2;

    const winners: string[] = [];
    for (let i = 0; i < Math.min(advanceCount, scores.length); i++) {
      const score = scores[i];
      console.log("score", score);
      if (score) {
        score.advancesToNextRound = true;
        winners.push(score.userId);
      }
    }

    console.log("winners", winners);

    room.scores = scores;
    room.winners = winners;
    console.log(
      `[ROOM STATUS] Room ${roomId}: ${room.status} -> ${RoomStage.COMPLETED}`
    );
    room.status = RoomStage.COMPLETED;
    room.completedAt = new Date();

    await this.roomService.updateRoom(room);

    for (const score of scores) {
      await this.roomService.saveScore(score);
    }

    console.log(
      `[RESULTS STATUS] Room ${roomId}: Results calculated, winners: ${winners.join(
        ", "
      )}`
    );
    this.io.to(roomId).emit("results:calculated", roomId, scores);
    this.io.to(roomId).emit("results:winners_announced", roomId, winners);

    console.log(`[ROUND STATUS] Room ${roomId}: Preparing for next round`);
    this.io.to(roomId).emit("round:preparing_next", roomId, room.roundId);

    console.log(
      `[ROOM EVENT] Room ${roomId}: Stage changed to ${RoomStage.COMPLETED}`
    );
    this.io.to(roomId).emit("room:stage_changed", roomId, RoomStage.COMPLETED);

    return { scores, winners };
  }
}
