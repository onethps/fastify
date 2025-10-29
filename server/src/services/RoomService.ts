import { Server as SocketServer } from "socket.io";
import {
  FIRESTORE_COLLECTIONS,
  ParticipantStatus,
  TournamentRoom,
  VoteRecord,
  Tournament,
} from "../types/tournament.types";

export class RoomService {
  private io: SocketServer;
  private firestore: any;

  constructor(io: SocketServer, firestore: any) {
    this.io = io;
    this.firestore = firestore;
  }

  async getRoom(id: string): Promise<TournamentRoom | null> {
    const doc = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .doc(id)
      .get();

    return doc.exists ? (doc.data() as TournamentRoom) : null;
  }

  async updateRoom(room: TournamentRoom): Promise<void> {
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .doc(room.id)
      .set(room);
  }

  async updateParticipantStatus(
    roomId: string,
    userId: string,
    status: ParticipantStatus
  ): Promise<void> {
    console.log(
      `[PARTICIPANT STATUS] Room ${roomId}: User ${userId} -> ${status}`
    );
    this.io
      .to(roomId)
      .emit("participant:status_changed", roomId, userId, status);
  }

  async getTournament(tournamentId: string): Promise<Tournament | null> {
    const doc = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.TOURNAMENTS)
      .doc(tournamentId)
      .get();

    return doc.exists ? (doc.data() as Tournament) : null;
  }

  async saveVote(voteRecord: VoteRecord): Promise<void> {
    await this.firestore
      .collection(FIRESTORE_COLLECTIONS.VOTES)
      .doc(voteRecord.id)
      .set(voteRecord);
  }

  async saveScore(score: any): Promise<void> {
    await this.firestore.collection(FIRESTORE_COLLECTIONS.SCORES).add(score);
  }

  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  broadcastToRoom(roomId: string, event: string, ...args: any[]): void {
    this.io.to(roomId).emit(event, roomId, ...args);
  }

  broadcast(event: string, ...args: any[]): void {
    this.io.emit(event, ...args);
  }

  joinRoom(socketId: string, roomId: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(roomId);
    }
  }

  leaveRoom(socketId: string, roomId: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(roomId);
    }
  }

  async getRoomByUserId(userId: string): Promise<string | null> {
    const roomsSnapshot = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .where("participantIds", "array-contains", userId)
      .get();

    if (roomsSnapshot.empty) {
      return null;
    }

    return roomsSnapshot.docs[0].id;
  }

  async getRoomsForRound(roundId: string): Promise<TournamentRoom[]> {
    const roomsSnapshot = await this.firestore
      .collection(FIRESTORE_COLLECTIONS.ROOMS)
      .where("roundId", "==", roundId)
      .get();

    return roomsSnapshot.docs.map((doc: any) => doc.data() as TournamentRoom);
  }

  async findRoomsWithSpace(
    roundId: string,
    maxPerRoom: number
  ): Promise<TournamentRoom[]> {
    const rooms = await this.getRoomsForRound(roundId);
    return rooms.filter((room) => room.participantIds.length < maxPerRoom);
  }

  async addParticipantsToRoom(
    roomId: string,
    participants: string[]
  ): Promise<void> {
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    room.participantIds.push(...participants);
    room.performanceOrder.push(...participants);

    await this.updateRoom(room);
  }

  async calculateWinners(roomId: string): Promise<string[]> {
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error("Room not found");
    }

    const tournament = await this.getTournament(room.tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found");
    }

    const scoreMap = new Map<
      string,
      { totalScore: number; voteCount: number }
    >();

    room.participantIds.forEach((participantId) => {
      scoreMap.set(participantId, { totalScore: 0, voteCount: 0 });
    });

    room.votes.forEach((vote) => {
      const current = scoreMap.get(vote.votedForId);
      if (current) {
        current.totalScore += vote.score;
        current.voteCount += 1;
      }
    });

    const scores = Array.from(scoreMap.entries()).map(([userId, data]) => ({
      userId,
      roomId: room.id,
      roundNumber: room.roundNumber,
      totalScore: data.totalScore,
      voteCount: data.voteCount,
      averageScore: data.voteCount > 0 ? data.totalScore / data.voteCount : 0,
      rank: 0,
      advancesToNextRound: false,
    }));

    scores.sort((a, b) => b.totalScore - a.totalScore);

    scores.forEach((score, index) => {
      score.rank = index + 1;
      score.advancesToNextRound = index < tournament.advancePerRoom;
    });

    room.scores = scores;

    for (const score of scores) {
      await this.saveScore(score);
    }

    const winners = scores
      .filter((s) => s.advancesToNextRound)
      .map((s) => s.userId);

    room.winners = winners;
    room.status = "results" as any;
    room.completedAt = new Date();

    await this.updateRoom(room);

    console.log(
      `[ROOM RESULTS] Room ${roomId}: Winners calculated - ${winners.join(
        ", "
      )}`
    );
    this.io.to(roomId).emit("room:stage_changed", roomId, "results");
    this.io.to(roomId).emit("results:calculated", roomId, scores);
    this.io.to(roomId).emit("results:winners_announced", roomId, winners);

    return winners;
  }
}
