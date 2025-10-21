import admin from "firebase-admin";
import type { ServiceAccount } from "firebase-admin";
import serviceAccount from "../serviceAccountKey.json";

// Firebase configuration using service account key file
const FIREBASE_CONFIG = {
  credential: admin.credential.cert(serviceAccount as ServiceAccount),
} as const;

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebase(): admin.app.App {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  try {
    if (admin.apps.length > 0) {
      firebaseAdmin = admin.apps[0] || null;
      return firebaseAdmin!;
    }

    firebaseAdmin = admin.initializeApp(FIREBASE_CONFIG);

    console.log("✅ Firebase Admin SDK initialized successfully");
    return firebaseAdmin;
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin SDK:", error);
    throw new Error(
      `Firebase initialization failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export function getFirebaseAdmin(): admin.app.App {
  if (!firebaseAdmin) {
    return initializeFirebase();
  }
  return firebaseAdmin;
}

export function isFirebaseInitialized(): boolean {
  return firebaseAdmin !== null && admin.apps.length > 0;
}

export function getFirebaseAuth() {
  return getFirebaseAdmin().auth();
}

export function getFirestore() {
  return getFirebaseAdmin().firestore();
}
