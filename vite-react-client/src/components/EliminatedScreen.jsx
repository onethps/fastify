const EliminatedScreen = ({ currentUserId }) => {
  return (
    <>
      <style>
        {`
          @keyframes fadeInScale {
            0% {
              opacity: 0;
              transform: scale(0.8);
            }
            100% {
              opacity: 1;
              transform: scale(1);
            }
          }
          @keyframes pulse {
            0%, 100% {
              transform: scale(1);
            }
            50% {
              transform: scale(1.1);
            }
          }
        `}
      </style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "400px",
          padding: "40px",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
          margin: "20px 0",
          animation: "fadeInScale 0.5s ease-out",
        }}
      >
        <div
          style={{
            fontSize: "80px",
            marginBottom: "20px",
            animation: "pulse 2s ease-in-out infinite",
          }}
        >
          ❌
        </div>
        <h1
          style={{
            fontSize: "48px",
            fontWeight: "bold",
            color: "#ffffff",
            marginBottom: "16px",
            textAlign: "center",
            textShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
          }}
        >
          Eliminated
        </h1>
        <p
          style={{
            fontSize: "20px",
            color: "#f0f0f0",
            marginBottom: "24px",
            textAlign: "center",
          }}
        >
          {currentUserId} has been eliminated from the tournament
        </p>
        <div
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            padding: "20px 32px",
            borderRadius: "8px",
            backdropFilter: "blur(10px)",
          }}
        >
          <p
            style={{
              fontSize: "16px",
              color: "#ffffff",
              margin: 0,
              textAlign: "center",
            }}
          >
            Thank you for participating!
          </p>
          <p
            style={{
              fontSize: "14px",
              color: "#e0e0e0",
              marginTop: "8px",
              textAlign: "center",
            }}
          >
            Better luck next time
          </p>
        </div>
      </div>
    </>
  );
};

export default EliminatedScreen;
