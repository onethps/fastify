import { useState, useEffect } from "react";

const VotingPanel = ({ socket, currentRoomId, currentUserId, logEvent }) => {
  const [participants, setParticipants] = useState([]);
  const [votes, setVotes] = useState({});
  const [hasVoted, setHasVoted] = useState(false);
  const [isVotingStage, setIsVotingStage] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const handleVotingStarted = async (roomId) => {
      if (roomId !== currentRoomId) return;

      setIsVotingStage(true);
      setHasVoted(false);
      setVotes({});

      logEvent("info", "Voting stage started");

      socket.emit("room:get_data", roomId, (room, error) => {
        if (error) {
          logEvent("error", `Failed to get room data: ${error}`);
          return;
        }
        if (room && room.participantIds) {
          const otherParticipants = room.participantIds.filter(
            (id) => id !== currentUserId
          );
          setParticipants(otherParticipants);
          logEvent(
            "info",
            `Participants in room: ${otherParticipants.join(", ")}`
          );
        }
      });
    };

    const handleVotingCompleted = (roomId) => {
      if (roomId !== currentRoomId) return;
      setIsVotingStage(false);
      logEvent("info", "Voting completed");
    };

    const handleStageChanged = (roomId, stage) => {
      if (roomId !== currentRoomId) return;
      setIsVotingStage(stage === "voting");
    };

    socket.on("voting:started", handleVotingStarted);
    socket.on("voting:completed", handleVotingCompleted);
    socket.on("room:stage_changed", handleStageChanged);

    return () => {
      socket.off("voting:started", handleVotingStarted);
      socket.off("voting:completed", handleVotingCompleted);
      socket.off("room:stage_changed", handleStageChanged);
    };
  }, [socket, currentRoomId, currentUserId, logEvent]);

  const handleStarClick = (participantId, rating) => {
    if (hasVoted) return;

    setVotes((prev) => ({
      ...prev,
      [participantId]: rating,
    }));
  };

  const handleSubmitVote = () => {
    if (!socket || !currentRoomId || hasVoted) return;

    const voteArray = Object.entries(votes).map(([votedForId, score]) => ({
      votedForId,
      score,
    }));

    if (voteArray.length === 0) {
      logEvent("error", "Please rate at least one participant");
      return;
    }

    logEvent("info", "Submitting votes...");

    socket.emit("vote:submit", currentRoomId, voteArray, (success) => {
      if (success) {
        setHasVoted(true);
        logEvent("success", "Vote submitted!");
      } else {
        logEvent("error", "Failed to submit vote");
      }
    });
  };

  if (!isVotingStage) {
    return null;
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Vote for Participants</h2>

      {participants.length === 0 ? (
        <p style={styles.noParticipants}>No participants to vote for</p>
      ) : (
        <div style={styles.participantsList}>
          {participants.map((participantId) => (
            <div key={participantId} style={styles.participantCard}>
              <div style={styles.participantName}>{participantId}</div>
              <div style={styles.stars}>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    onClick={() => handleStarClick(participantId, rating)}
                    disabled={hasVoted}
                    style={{
                      ...styles.star,
                      ...(votes[participantId] >= rating
                        ? styles.starFilled
                        : {}),
                      ...(hasVoted ? styles.starDisabled : {}),
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
              {votes[participantId] && (
                <div style={styles.selectedRating}>
                  Rating: {votes[participantId]} / 5
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleSubmitVote}
        disabled={hasVoted || Object.keys(votes).length === 0}
        style={{
          ...styles.submitButton,
          ...(hasVoted || Object.keys(votes).length === 0
            ? styles.submitButtonDisabled
            : {}),
        }}
      >
        {hasVoted ? "Vote Submitted" : "Submit Vote"}
      </button>
    </div>
  );
};

const styles = {
  container: {
    padding: "20px",
    backgroundColor: "#f8f9fa",
    borderRadius: "8px",
    marginTop: "20px",
  },
  title: {
    fontSize: "20px",
    fontWeight: "600",
    marginBottom: "16px",
    color: "#333",
  },
  noParticipants: {
    color: "#666",
    fontStyle: "italic",
  },
  participantsList: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  participantCard: {
    backgroundColor: "white",
    padding: "16px",
    borderRadius: "8px",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  },
  participantName: {
    fontSize: "14px",
    fontWeight: "600",
    marginBottom: "12px",
    color: "#667eea",
    fontFamily: "monospace",
  },
  stars: {
    display: "flex",
    gap: "8px",
  },
  star: {
    fontSize: "32px",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0",
    color: "#ddd",
    transition: "color 0.2s",
    outline: "none",
  },
  starFilled: {
    color: "#fbbf24",
  },
  starDisabled: {
    cursor: "not-allowed",
    opacity: "0.6",
  },
  selectedRating: {
    marginTop: "8px",
    fontSize: "12px",
    color: "#666",
  },
  submitButton: {
    width: "100%",
    padding: "12px",
    marginTop: "20px",
    backgroundColor: "#667eea",
    color: "white",
    border: "none",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.2s",
  },
  submitButtonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed",
  },
};

export default VotingPanel;
