const Dashboard = ({ tournamentData }) => {
  const getTimerTypeDisplay = () => {
    switch (tournamentData.timerType) {
      case "preparation":
        return "⏳ Preparation";
      case "performance":
        return "🎤 Performance";
      case "voting":
        return "🗳️ Voting";
      default:
        return "-";
    }
  };

  const getRoomStageDisplay = (stage) => {
    switch (stage) {
      case "waiting_for_round_completion":
        return "⏳ Waiting for all rooms";
      case "waiting":
        return "⏸️ Waiting";
      case "performance":
        return "🎤 Performance";
      case "voting":
        return "🗳️ Voting";
      case "results":
        return "📊 Results";
      case "completed":
        return "✅ Completed";
      case "eliminated":
        return "❌ Eliminated";
      case "winner_announced":
        return "🏆 WINNER!";
      default:
        return stage || "-";
    }
  };

  return (
    <div className="panel">
      <h2>Dashboard</h2>

      <div className="tournament-info">
        <div className="info-row">
          <span className="info-label">Tournament Status</span>
          <span className="info-value">{tournamentData.status}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Current Round</span>
          <span className="info-value">{tournamentData.currentRound}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Participants</span>
          <span className="info-value">{tournamentData.participantCount}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Room ID</span>
          <span
            className="info-value"
            style={{ fontSize: "11px", fontFamily: "monospace" }}
          >
            {tournamentData.roomId}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Room Stage</span>
          <span className="info-value" style={{ fontSize: "16px" }}>
            {getRoomStageDisplay(tournamentData.roomStage)}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">
            {tournamentData.roomStage === "winner_announced"
              ? "Tournament Winner"
              : "Current Performer"}
          </span>
          <span
            className="info-value"
            style={
              tournamentData.roomStage === "winner_announced"
                ? {
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "#FFD700",
                    textShadow: "0 0 10px rgba(255, 215, 0, 0.5)",
                  }
                : {}
            }
          >
            {tournamentData.currentPerformer}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Timer Type</span>
          <span className="info-value" style={{ fontSize: "16px" }}>
            {getTimerTypeDisplay()}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Timer</span>
          <span
            className="info-value"
            style={{ fontSize: "20px", fontWeight: "bold", color: "#667eea" }}
          >
            {tournamentData.timerValue}
          </span>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
