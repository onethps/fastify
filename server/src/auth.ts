import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAdmin } from "./firebase.js";
import { DEV_CONFIG } from "./config.js";

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string = "AUTH_ERROR",
    public originalError?: Error
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

function createMockDecodedToken(userId: string): DecodedIdToken {
  const now = Math.floor(Date.now() / 1000);
  return {
    uid: userId,
    aud: "mock-audience",
    auth_time: now,
    exp: now + 3600,
    iat: now,
    iss: "mock-issuer",
    sub: userId,
    email: `${userId}@test.local`,
    email_verified: true,
  } as DecodedIdToken;
}

export async function authenticateSocket(
  token: string
): Promise<DecodedIdToken> {
  if (!token || typeof token !== "string") {
    throw new AuthenticationError(
      "Token is required and must be a string",
      "INVALID_TOKEN"
    );
  }

  if (DEV_CONFIG.allowMockTokens && token.startsWith("dev_user_")) {
    // console.log(`🔓 DEV MODE: Using mock token for ${token}`);
    return createMockDecodedToken(token);
  }

  try {
    const admin = getFirebaseAdmin();
    const decodedToken = await admin.auth().verifyIdToken(token);

    if (!decodedToken.uid) {
      throw new AuthenticationError(
        "Token missing user ID",
        "INVALID_TOKEN_CLAIMS"
      );
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (decodedToken.exp && decodedToken.exp < currentTime) {
      throw new AuthenticationError("Token has expired", "TOKEN_EXPIRED");
    }

    return decodedToken;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    const firebaseError = error as any;
    let errorMessage = "Authentication failed";
    let errorCode = "AUTH_ERROR";

    if (firebaseError.code) {
      switch (firebaseError.code) {
        case "auth/invalid-argument":
          errorMessage = "Invalid token format";
          errorCode = "INVALID_TOKEN_FORMAT";
          break;
        case "auth/id-token-expired":
          errorMessage = "Token has expired";
          errorCode = "TOKEN_EXPIRED";
          break;
        case "auth/id-token-revoked":
          errorMessage = "Token has been revoked";
          errorCode = "TOKEN_REVOKED";
          break;
        case "auth/invalid-id-token":
          errorMessage = "Invalid token";
          errorCode = "INVALID_TOKEN";
          break;
        case "auth/argument-error":
          errorMessage = "Invalid token argument";
          errorCode = "INVALID_ARGUMENT";
          break;
        default:
          errorMessage = `Authentication error: ${firebaseError.message}`;
          errorCode = "FIREBASE_ERROR";
      }
    }

    throw new AuthenticationError(errorMessage, errorCode, error as Error);
  }
}

export function validateUserPermissions(decodedToken: DecodedIdToken): boolean {
  if (!decodedToken.email_verified && decodedToken.email) {
    return false; // Require email verification
  }

  return true;
}

export function isTokenExpired(decodedToken: DecodedIdToken): boolean {
  const currentTime = Math.floor(Date.now() / 1000);
  return decodedToken.exp ? decodedToken.exp < currentTime : true;
}

export function getTokenExpirationTime(
  decodedToken: DecodedIdToken
): number | null {
  return decodedToken.exp || null;
}

export function getTokenTimeUntilExpiration(
  decodedToken: DecodedIdToken
): number {
  if (!decodedToken.exp) return 0;
  const currentTime = Math.floor(Date.now() / 1000);
  return Math.max(0, decodedToken.exp - currentTime);
}
