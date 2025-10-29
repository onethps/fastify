import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3000";

export const useSocket = (userId) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [tournamentData, setTournamentData] = useState({
    status: "-",
    currentRound: "-",
    participantCount: "-",
    roomStage: "-",
    currentPerformer: "-",
    timerValue: "-",
    timerType: "-",
    roomId: "-",
  });

  const socketRef = useRef(null);

  const updateRoomStage = useCallback((stage) => {
    setTournamentData((prev) =>
      prev.roomStage === "eliminated" ? prev : { ...prev, roomStage: stage }
    );
  }, []);

  const resetRoomStage = useCallback(() => {
    setTournamentData((prev) => ({ ...prev, roomStage: "-" }));
  }, []);

  const logEvent = useCallback((type, message) => {
    const time = new Date().toLocaleTimeString();
    setEvents((prev) => [
      { type, message, time, id: Date.now() },
      ...prev.slice(0, 99),
    ]);
  }, []);

  const connect = useCallback(() => {
    if (!userId) {
      logEvent("error", "No user selected");
      return;
    }

    if (socketRef.current?.connected) {
      logEvent("info", "Already connected");
      return;
    }

    logEvent("info", `Connecting as ${userId}...`);

    console.log("🔌 Connecting with config:", {
      userId,
      serverUrl: SERVER_URL,
      auth: { token: userId },
    });

    const newSocket = io(SERVER_URL, {
      auth: {
        token: userId,
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("✅ Socket connected:", newSocket.id);
      logEvent("success", `Connected! Socket ID: ${newSocket.id}`);
      setIsConnected(true);
    });

    newSocket.on("disconnect", (reason) => {
      console.log("❌ Socket disconnected:", reason);
      logEvent("error", `Disconnected: ${reason}`);
      setIsConnected(false);
    });

    newSocket.on("connect_error", (error) => {
      console.error("🚫 Connection error:", error);
      logEvent("error", `Connection error: ${error.message}`);
    });

    newSocket.on("CONNECTED", (data) => {
      console.log("✅ Server confirmed:", data);
      logEvent("success", `Server confirmed connection for: ${data.userId}`);
    });

    newSocket.on("ERROR", (error) => {
      console.error("⚠️ Server error:", error);
      logEvent("error", `Server error: ${error.message} (${error.code})`);
    });

    newSocket.on("ping", () => {
      newSocket.emit("pong");
    });

    newSocket.on("tournament:created", (tournament) => {
      logEvent("success", `Tournament created: ${tournament.id}`);
      setTournamentData((prev) => ({
        ...prev,
        status: tournament.status,
        currentRound: `${tournament.currentRound} / ${tournament.totalRounds}`,
        participantCount: tournament.participants.length,
      }));
      resetRoomStage();
    });

    newSocket.on("tournament:started", (tournamentId) => {
      logEvent("success", `Tournament started: ${tournamentId}`);
      setTournamentData((prev) => ({ ...prev, status: "IN_PROGRESS" }));
      resetRoomStage();
    });

    newSocket.on("tournament:countdown", (tournamentId, timeLeft) => {
      logEvent("info", `Tournament countdown: ${timeLeft}s`);
      setTournamentData((prev) => ({
        ...prev,
        status: `Starting in ${timeLeft}s`,
      }));
    });

    newSocket.on("tournament:auto_started", (tournamentId) => {
      logEvent("success", `Tournament auto-started: ${tournamentId}`);
      resetRoomStage();
    });

    newSocket.on("tournament:completed", (tournamentId, winnerId) => {
      logEvent("success", `🏆 Tournament completed! Winner: ${winnerId}`);
      setTournamentData((prev) => ({ ...prev, status: "COMPLETED" }));
    });

    newSocket.on("tournament:winner_announced", (tournamentId, winnerData) => {
      logEvent(
        "success",
        `🏆🏆🏆 TOURNAMENT WINNER: ${winnerData.winnerId} with score ${winnerData.score}! 🏆🏆🏆`
      );
      setTournamentData((prev) => ({
        ...prev,
        status: "COMPLETED",
        currentPerformer: `🏆 ${winnerData.winnerId}`,
      }));
      updateRoomStage("winner_announced");
      console.log("Final Standings:", winnerData.allScores);
    });

    newSocket.on("tournament:round_advancing", (tournamentId, roundNumber) => {
      logEvent("success", `🎯 Advancing to Round ${roundNumber}!`);
      setTournamentData((prev) => ({
        ...prev,
        currentRound: roundNumber,
        currentPerformer: "-",
        timerValue: "-",
        timerType: "-",
      }));
      updateRoomStage("waiting");
    });

    newSocket.on(
      "tournament:participant_moved_to_room",
      (tournamentId, roundId) => {
        logEvent("info", `Moved to room in round: ${roundId}`);
      }
    );

    newSocket.on("room:created", (room) => {
      logEvent("info", `Room created: ${room.id}`);
    });

    newSocket.on("room:assigned", (room) => {
      logEvent("success", `Assigned to room: ${room.id}`);
      setCurrentRoomId(room.id);
      setTournamentData((prev) => ({
        ...prev,
        currentRound: room.roundNumber,
        roomId: room.id,
      }));

      updateRoomStage(room.status);

      console.log("🎯 Auto-joining room:", room.id);
      newSocket.emit("room:join", room.id, (success, error) => {
        if (success) {
          logEvent("success", `Auto-joined room ${room.id}`);
        } else {
          logEvent("error", `Failed to auto-join room: ${error}`);
        }
      });
    });

    newSocket.on("room:stage_changed", (roomId, stage) => {
      logEvent("info", `Room ${roomId} stage: ${stage}`);
      updateRoomStage(stage);
    });

    newSocket.on("participant:joined", (roomId, userId) => {
      logEvent("info", `${userId} joined room ${roomId}`);
    });

    newSocket.on("participant:status_changed", (roomId, userId, status) => {
      logEvent("info", `${userId} status: ${status}`);
    });

    newSocket.on("timer:tick", (roomId, remaining) => {
      setTournamentData((prev) => ({ ...prev, timerValue: `${remaining}s` }));
    });

    newSocket.on("timer:started", (roomId, timer) => {
      logEvent("info", `Timer started: ${timer.type} (${timer.duration}s)`);
      setTournamentData((prev) => ({
        ...prev,
        timerType: timer.type,
        timerValue: `${timer.duration}s`,
      }));
    });

    newSocket.on("timer:completed", (roomId) => {
      logEvent("info", `Timer completed in room ${roomId}`);
      setTournamentData((prev) => ({
        ...prev,
        timerValue: "-",
        timerType: "-",
      }));
    });

    newSocket.on("performance:preparation_started", (roomId, performerId) => {
      logEvent("info", `Preparation started for ${performerId}`);
      setTournamentData((prev) => ({ ...prev, currentPerformer: performerId }));
    });

    newSocket.on("performance:started", (roomId, performerId) => {
      logEvent("success", `Performance started: ${performerId}`);
      setTournamentData((prev) => ({ ...prev, currentPerformer: performerId }));
    });

    newSocket.on("performance:completed", (roomId, performerId) => {
      logEvent("info", `Performance completed: ${performerId}`);
    });

    newSocket.on("performance:next", (roomId, nextPerformerId) => {
      logEvent("info", `Next performer: ${nextPerformerId}`);
    });

    newSocket.on("voting:started", (roomId) => {
      logEvent("success", `Voting started in room ${roomId}`);
      updateRoomStage("VOTING");
    });

    newSocket.on("voting:received", (roomId, voterId) => {
      logEvent("info", `Vote received from ${voterId}`);
    });

    newSocket.on("voting:completed", (roomId) => {
      logEvent("success", `Voting completed in room ${roomId}`);
    });

    newSocket.on("room:waiting_for_completion", (roomId) => {
      logEvent("info", `Waiting for all rooms to finish voting...`);
      setTournamentData((prev) => ({
        ...prev,
        currentPerformer: "Waiting for winners...",
      }));
      updateRoomStage("waiting_for_round_completion");
    });

    newSocket.on("round:all_rooms_completed", (roundId) => {
      logEvent("success", `All rooms completed voting in round ${roundId}`);
    });

    newSocket.on("round:completed", (roundId) => {
      logEvent("success", `✅ Round ${roundId} completed! Winners are ready.`);
      setTournamentData((prev) => ({
        ...prev,
        currentPerformer: "Round completed!",
      }));
      updateRoomStage("completed");
    });

    newSocket.on("results:calculated", (roomId, scores) => {
      logEvent("success", `Results calculated for room ${roomId}`);
      console.log("Scores:", scores);
    });

    newSocket.on("results:winners_announced", (roomId, winners) => {
      logEvent("success", `Winners: ${winners.join(", ")}`);
    });

    newSocket.on(
      "round:participant_advances",
      (roundId, participantId, nextRoundId) => {
        logEvent("success", `🎉 ${participantId} advances to next round!`);
      }
    );

    newSocket.on("round:participant_eliminated", (roundId, participantId) => {
      logEvent("error", `❌ ${participantId} eliminated from tournament`);
      setTournamentData((prev) => ({
        ...prev,
        roomStage: "eliminated",
        currentPerformer: "Eliminated",
      }));
    });
  }, [userId, logEvent]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    connect,
    disconnect,
    events,
    tournamentData,
    currentRoomId,
    logEvent,
  };
};
