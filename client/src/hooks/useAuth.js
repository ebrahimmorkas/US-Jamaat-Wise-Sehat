import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, getMe, login, logout } from "../lib/api";

const WAKE_MESSAGE = "Starting the server… this can take up to a minute.";

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
      } else if (attempt < 24) {
        // Server waking up or a network blip: keep trying for ~2 minutes.
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

  const signIn = useCallback(async (username, password) => {
    const { user } = await login(username, password);
    setState({ status: "authed", user, message: "" });
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setState({ status: "anon", user: null, message: "You have signed out." });
  }, []);

  const expire = useCallback(() => {
    setState({ status: "anon", user: null, message: "Your session has ended. Please sign in again." });
  }, []);

  return { ...state, signIn, signOut, expire };
}
