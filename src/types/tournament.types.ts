export enum TournamentStatus {
  CREATED = "created",
  REGISTRATION = "registration",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  PREPARING = "preparing",
}

export enum RoundStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  PERFORMANCE = "performance",
  VOTING = "voting",
  COMPLETED = "completed",
}

export enum RoomStage {
  WAITING = "waiting",
  PERFORMANCE = "performance",
  VOTING = "voting",
  RESULTS = "results",
  COMPLETED = "completed",
}

export enum ParticipantStatus {
  REGISTERED = "registered",
  ACTIVE = "active",
  PERFORMING = "performing",
  VOTING = "voting",
  WAITING_FOR_ROUND_COMPLETION = "waiting_for_round_completion",
  ELIMINATED = "eliminated",
  WINNER = "winner",
  OFFLINE = "offline",
}

export interface Tournament {
  id: string;
  name: string;
  description?: string;
  status: TournamentStatus;

  maxParticipantsPerRoom: number;
  performanceTimeSeconds: number;
  votingTimeSeconds: number;
  advancePerRoom: number;

  currentRound: number;
  totalRounds: number;
  participants: string[];

  createdBy: string;
  createdAt: Date;
  startAt?: number;
  startedAt?: Date;
  completedAt?: Date;
  winnerId?: string;
}

export interface TournamentRound {
  id: string;
  tournamentId: string;
  roundNumber: number;
  status: RoundStatus;

  rooms: TournamentRoom[];
  participantIds: string[];
  startedAt?: Date;
  completedAt?: Date;
}

export interface TournamentRoom {
  id: string;
  tournamentId: string;
  roundId: string;
  roundNumber: number;
  roomNumber: number;
  status: RoomStage;
  participantIds: string[];
  currentPerformerId?: string;
  performanceOrder: string[];
  currentPerformanceIndex: number;
  timer: RoomTimer;
  preparationTimer?: RoomTimer;
  votes: VoteRecord[];
  scores: ParticipantScore[];
  winners: string[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface RoomTimer {
  id: string;
  roomId: string;

  type: "preparation" | "performance" | "voting";
  duration: number;
  remaining: number;

  isRunning: boolean;
  isPaused: boolean;

  startedAt?: Date;
  pausedAt?: Date;
  completedAt?: Date;
}

export interface ParticipantInRoom {
  userId: string;
  roomId: string;
  tournamentId: string;
  roundNumber: number;

  status: ParticipantStatus;

  isOnline: boolean;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  hasPerformed: boolean;
  hasVoted: boolean;
  performanceCompletedAt?: Date;
  agoraUid?: string;
  agoraToken?: string;

  joinedAt: Date;
  leftAt?: Date;
}

export interface VoteRecord {
  id: string;
  roomId: string;
  roundId: string;

  voterId: string;
  votedForId: string;
  score: number;

  createdAt: Date;
}

export interface ParticipantScore {
  userId: string;
  roomId: string;
  roundNumber: number;

  totalScore: number;
  voteCount: number;
  averageScore: number;

  rank: number;
  advancesToNextRound: boolean;
}

export interface TournamentSession {
  id: string;
  tournamentId: string;

  participantId: string;

  rounds: {
    roundNumber: number;
    roomId: string;
    score?: number;
    rank?: number;
    advanced: boolean;
  }[];

  finalRank?: number;
  isWinner: boolean;

  startedAt: Date;
  completedAt?: Date;
}

export interface SocketEvents {
  "tournament:created": (tournament: Tournament) => void;
  "tournament:started": (tournamentId: string) => void;
  "tournament:completed": (tournamentId: string, winnerId: string) => void;

  "round:started": (roundData: TournamentRound) => void;
  "round:completed": (roundId: string) => void;

  "room:created": (room: TournamentRoom) => void;
  "room:assigned": (room: TournamentRoom) => void;
  "room:stage_changed": (roomId: string, stage: RoomStage) => void;
  "room:participants_assigned": (
    roomId: string,
    participantIds: string[]
  ) => void;

  "performance:preparation_started": (
    roomId: string,
    performerId: string
  ) => void;
  "performance:preparation_completed": (
    roomId: string,
    performerId: string
  ) => void;
  "performance:started": (roomId: string, performerId: string) => void;
  "performance:completed": (roomId: string, performerId: string) => void;
  "performance:next": (roomId: string, nextPerformerId: string) => void;

  "timer:tick": (roomId: string, remaining: number) => void;
  "timer:started": (roomId: string, timer: RoomTimer) => void;
  "timer:paused": (roomId: string) => void;
  "timer:resumed": (roomId: string) => void;
  "timer:completed": (roomId: string) => void;

  "voting:started": (roomId: string) => void;
  "voting:received": (roomId: string, voterId: string) => void;
  "voting:completed": (roomId: string) => void;
  "voting:auto_scored": (roomId: string, participantIds: string[]) => void;

  "results:calculated": (roomId: string, scores: ParticipantScore[]) => void;
  "results:winners_announced": (roomId: string, winners: string[]) => void;
  "round:preparing_next": (roomId: string, roundId: string) => void;
  "round:next_ready": (roundId: string, nextRoundId: string) => void;

  "round:waiting_for_completion": (
    roundId: string,
    participantId: string
  ) => void;
  "round:all_rooms_completed": (roundId: string) => void;
  "round:participant_advances": (
    roundId: string,
    participantId: string,
    nextRoundId: string
  ) => void;
  "round:participant_eliminated": (
    roundId: string,
    participantId: string
  ) => void;

  "participant:joined": (roomId: string, userId: string) => void;
  "participant:left": (roomId: string, userId: string) => void;
  "participant:status_changed": (
    roomId: string,
    userId: string,
    status: ParticipantStatus
  ) => void;
  "participant:media_changed": (
    roomId: string,
    userId: string,
    mediaState: MediaState
  ) => void;
}

export interface MediaState {
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
}

export interface ClientToServerEvents {
  "tournament:join": (
    tournamentId: string,
    callback: (success: boolean, error?: string) => void
  ) => void;
  "tournament:leave": (tournamentId: string) => void;

  "room:join": (
    roomId: string,
    callback: (success: boolean, error?: string) => void
  ) => void;
  "room:ready": (roomId: string) => void;

  "performance:ready": (roomId: string) => void;
  "performance:start": (roomId: string) => void;
  "performance:complete": (roomId: string) => void;
  "performance:skip_preparation": (roomId: string) => void;

  "vote:submit": (
    roomId: string,
    votes: { votedForId: string; score: number }[],
    callback: (success: boolean) => void
  ) => void;

  "media:toggle_mute": (roomId: string, isMuted: boolean) => void;
  "media:toggle_camera": (roomId: string, isCameraOn: boolean) => void;
  "media:toggle_screen": (roomId: string, isSharing: boolean) => void;

  "admin:start_round": (tournamentId: string) => void;
  "admin:pause_timer": (roomId: string) => void;
  "admin:resume_timer": (roomId: string) => void;
  "admin:skip_stage": (roomId: string) => void;
}

export const REDIS_KEYS = {
  tournament: (id: string) => `tournament:${id}`,
  tournamentParticipants: (id: string) => `tournament:${id}:participants`,
  tournamentCurrentRound: (id: string) => `tournament:${id}:current_round`,

  round: (id: string) => `round:${id}`,
  roundRooms: (id: string) => `round:${id}:rooms`,

  room: (id: string) => `room:${id}`,
  roomParticipants: (id: string) => `room:${id}:participants`,
  roomTimer: (id: string) => `room:${id}:timer`,
  roomVotes: (id: string) => `room:${id}:votes`,
  roomScores: (id: string) => `room:${id}:scores`,

  participant: (userId: string) => `participant:${userId}`,
  participantRoom: (userId: string) => `participant:${userId}:room`,
  participantStatus: (userId: string) => `participant:${userId}:status`,

  activeConnections: () => `active:connections`,
  userSocket: (userId: string) => `user:${userId}:socket`,

  lock: (resource: string) => `lock:${resource}`,
} as const;

export const FIRESTORE_COLLECTIONS = {
  TOURNAMENTS: "batches_tournaments",
  ROUNDS: "batches_rounds",
  ROOMS: "batches_rooms",
  SESSIONS: "batches_sessions",
  PARTICIPANTS: "batches_participants",
  VOTES: "batches_votes",
  SCORES: "batches_scores",
} as const;
