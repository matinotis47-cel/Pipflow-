import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

// Read safely from Vite environment variables (Fixes Render build error)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogleIdToken(): Promise<string> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return await result.user.getIdToken();
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code === 'auth/popup-blocked') {
      throw new Error('Google sign-in popup was blocked by your browser. Please allow popups or sign in with email & password.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error('This preview domain is not authorized for Google popup sign-in yet. Use email & password or the Demo workspace sign-in.');
    }
    throw new Error(err?.message || 'Google sign-in failed.');
  }
}
