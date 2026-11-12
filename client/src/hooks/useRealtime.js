import { useEffect, useRef, useState } from "react";
import { getStatus, onReconnect, onStatus, subscribe } from "../lib/realtime";

/**
 * Live updates in a component:
 *   useRealtime("dashboard", "dashboard:changed", (data) => reload(), { onReconnect: reload });
 * `enabled: false` = don't listen (e.g. until the page has loaded).
 */
export function useRealtime(topic, event, handler, { enabled = true, onReconnect: reconnect } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;

  useEffect(() => {
    if (!enabled || !topic || !event) return undefined;
    const off = subscribe(topic, event, (data) => handlerRef.current && handlerRef.current(data));
    const offReconnect = onReconnect(() => reconnectRef.current && reconnectRef.current());
    return () => { off(); offReconnect(); };
  }, [topic, event, enabled]);
}

/** "idle" | "connecting" | "live" | "offline" | "off" */
export function useRealtimeStatus() {
  const [status, setStatus] = useState(getStatus);
  useEffect(() => {
    setStatus(getStatus());
    return onStatus(setStatus);
  }, []);
  return status;
}
