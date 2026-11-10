import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, devLogin, getMe, googleLogin, isServerStarting, logout } from "../lib/api";

const WAKE_MESSAGE = "Connecting to the server…";

// Who is signed in. status: "checking" | "authed" | "anon"
export function useAuth() {
  const [state, setState] = useState({ status: "checking", user: null, message: "" });
  const alive = useRef(true);

  const check = useCallback(async (attempt = 0) => {
    try {
      const { user } = await getMe();
      if (alive.current) setState({ status: "authed", user, message: "" });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof AuthError) {
        setState({ status: "anon", user: null, message: "" });
      } else if (isServerStarting(err) && attempt < 24) {
        // Server restarting (e.g. a deploy) or a network blip: keep trying for ~2 minutes.
        setState((s) => ({ ...s, message: WAKE_MESSAGE }));
        setTimeout(() => check(attempt + 1), 5000);
      } else {
        setState({ status: "anon", user: null, message: err.message });
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    check();
    return () => { alive.current = false; };
  }, [check]);

  // Google: `credential` is the ID token from the "Sign in with Google" button.
  const signInGoogle = useCallback(async (credential) => {
    const { user } = await googleLogin(credential);
    setState({ status: "authed", user, message: "" });
  }, []);
  // Local testing only (server must have DEV_LOGIN=true).
  const signInDev = useCallback(async (email) => {
    const { user } = await devLogin(email);
    setState({ status: "authed", user, message: "" });
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    try { window.google && window.google.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
    setState({ status: "anon", user: null, message: "You have signed out." });
  }, []);

  const expire = useCallback(() => {
    setState({ status: "anon", user: null, message: "Your session has ended. Please sign in again." });
  }, []);

  return { ...state, signInGoogle, signInDev, signOut, expire };
}
