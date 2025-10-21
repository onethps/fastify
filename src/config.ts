
export const SERVER_CONFIG = {
  port: 3000,
  host: "0.0.0.0",
  cors: {
    origin: "*",
  },
} as const;

export const LOG_LEVEL = "info" as const;

export const SERVER_INFO = {
  name: "Socket.IO with Firebase Auth",
  version: "1.0.0",
} as const;
