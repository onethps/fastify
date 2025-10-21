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
}
