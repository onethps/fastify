import { useState } from "react";

const Sidebar = ({
  isConnected,
  currentUserId,
  onConnect,
  onDisconnect,
  socket,
  logEvent,
  currentRoomId,
}) => {
  const [tournamentName, setTournamentName] = useState("Test Tournament");
  const [maxParticipants, setMaxParticipants] = useState(5);
  const [performanceTime, setPerformanceTime] = useState(30);
  const [votingTime, setVotingTime] = useState(20);
  const [tournamentId, setTournamentId] = useState("1761631038936-1fcuy2x6b");
  const [roomId, setRoomId] = useState("");

  const createTournament = () => {
    if (!socket?.connected) {
      logEvent("error", "Not connected");
      return;
    }

    const data = {
      name: tournamentName,
      maxParticipantsPerRoom: maxParticipants,
      performanceTimeSeconds: performanceTime,
      votingTimeSeconds: votingTime,
      advancePerRoom: 2,
      startAt: Date.now() + 30000,
    };

    logEvent("info", "Creating tournament...");

    socket.emit("tournament:create", data, (tournament, error) => {
      if (error) {
        logEvent("error", `Failed to create tournament: ${error}`);
      } else {
        logEvent("success", `Tournament created: ${tournament.id}`);
        setTournamentId(tournament.id);
      }
    });
  };

  const resetTournament = () => {
    if (!socket?.connected || !tournamentId) {
      logEvent("error", "Not connected or no tournament selected");
      return;
    }

    logEvent("info", "Resetting tournament...");
    socket.emit("tournament:reset_start", tournamentId, (success, error) => {
      if (success) {
        logEvent("success", `Tournament reset: ${tournamentId}`);
      } else {
        logEvent("error", `Failed to reset tournament: ${error}`);
      }
    });
  };

  const joinTournament = () => {
    if (!socket?.connected) {
      logEvent("error", "Not connected");
      return;
    }

    if (!tournamentId) {
      logEvent("error", "Enter tournament ID");
      return;
    }

    logEvent("info", `Joining tournament ${tournamentId}...`);

    socket.emit("tournament:join", tournamentId, (success, error) => {
      if (success) {
        logEvent("success", `Joined tournament ${tournamentId}`);
      } else {
        logEvent("error", `Failed to join: ${error}`);
      }
    });
  };

  const registerParticipant = () => {
    if (!socket?.connected || !tournamentId) {
      logEvent("error", "Not connected or no tournament selected");
      return;
    }

    logEvent("info", "Registering as participant...");

    socket.emit("tournament:register", tournamentId, (success, error) => {
      if (success) {
        logEvent("success", "Registered as participant!");
      } else {
        logEvent("error", `Registration failed: ${error}`);
      }
    });
  };

  const startTournament = () => {
    if (!socket?.connected || !tournamentId) {
      logEvent("error", "Not connected or no tournament selected");
      return;
    }

    logEvent("info", "Starting tournament...");
    socket.emit("admin:start_tournament", tournamentId);
  };

  const joinRoom = () => {
    const targetRoomId = roomId || currentRoomId;

    if (!socket?.connected || !targetRoomId) {
      logEvent("error", "Not connected or no room ID");
      return;
    }

    logEvent("info", `Joining room ${targetRoomId}...`);

    socket.emit("room:join", targetRoomId, (success, error) => {
      if (success) {
        logEvent("success", `Joined room ${targetRoomId}`);
      } else {
        logEvent("error", `Failed to join room: ${error}`);
      }
    });
  };

  const skipPreparation = () => {
    const targetRoomId = roomId || currentRoomId;

    if (!socket?.connected || !targetRoomId) {
      logEvent("error", "Not connected or no room");
      return;
    }

    logEvent("info", "Skipping preparation...");
    socket.emit("performance:skip_preparation", targetRoomId);
  };

  return (
    <div className="sidebar">
      <h2>Controls</h2>

      <div className="control-group">
        <label>Connection Status</label>
        <div>
          <span
            className={`status-badge ${
              isConnected ? "connected" : "disconnected"
            }`}
          >
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="control-group">
        <label>Current User</label>
        <div style={{ fontWeight: 600, color: "#667eea" }}>
          {currentUserId || "None"}
        </div>
      </div>

      <button onClick={onConnect} disabled={isConnected}>
        Connect
      </button>
      <button onClick={onDisconnect} className="danger" disabled={!isConnected}>
        Disconnect
      </button>

      <hr />

      <h2>Tournament</h2>

      <div className="control-group">
        <label>Tournament Name</label>
        <input
          type="text"
          value={tournamentName}
          onChange={(e) => setTournamentName(e.target.value)}
        />
      </div>

      <div className="control-group">
        <label>Max Participants Per Room</label>
        <input
          type="number"
          value={maxParticipants}
          onChange={(e) => setMaxParticipants(Number(e.target.value))}
          min="2"
        />
      </div>

      <div className="control-group">
        <label>Performance Time (seconds)</label>
        <input
          type="number"
          value={performanceTime}
          onChange={(e) => setPerformanceTime(Number(e.target.value))}
          min="10"
        />
      </div>

      <div className="control-group">
        <label>Voting Time (seconds)</label>
        <input
          type="number"
          value={votingTime}
          onChange={(e) => setVotingTime(Number(e.target.value))}
          min="10"
        />
      </div>

      <button onClick={createTournament} className="success">
        Create Tournament
      </button>

      <div className="control-group">
        <label>Tournament ID</label>
        <input
          type="text"
          value={tournamentId}
          onChange={(e) => setTournamentId(e.target.value)}
          placeholder="Enter tournament ID"
        />
      </div>

      <button onClick={joinTournament}>Join Tournament</button>
      <button onClick={registerParticipant}>Register as Participant</button>
      <button onClick={startTournament}>Start Tournament</button>
      <button onClick={resetTournament}>Reset Tournament</button>

      <hr />

      <h2>Room Actions</h2>

      <div className="control-group">
        <label>Room ID</label>
        <input
          type="text"
          value={roomId || currentRoomId || ""}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Auto-assigned when tournament starts"
          style={{
            fontSize: "11px",
            fontFamily: "monospace",
            background: currentRoomId ? "#f0fdf4" : "white",
          }}
        />
        {currentRoomId && (
          <small style={{ color: "#10b981", fontSize: "11px" }}>
            ✓ Auto-assigned
          </small>
        )}
      </div>

      <button onClick={joinRoom} disabled={!currentRoomId && !roomId}>
        Join Room {currentRoomId ? "(Auto)" : ""}
      </button>
      <button onClick={skipPreparation}>Skip Preparation</button>
    </div>
  );
};

export default Sidebar;
