export const IS_DEV_MODE = process.env.NODE_ENV !== "production";

export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT || "3000"),
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

export const DEV_CONFIG = {
  bypassAuth: IS_DEV_MODE,
  allowMockTokens: IS_DEV_MODE,
} as const;
