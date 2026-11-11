// Live updates (Socket.IO), shared by every page.
//
//   const off = subscribe("dashboard", "dashboard:changed", (data) => ...);   // later: off()
//   onStatus((status) => ...)   status: "idle" | "connecting" | "live" | "offline" | "off"
//   onReconnect(() => ...)      the connection came back: reload anything that may have been missed
//   stop()                      close the connection (sign-out)
//
// One connection per browser tab, opened when the first page subscribes and closed when the
// last one leaves. Where to connect comes from the server (/api/auth/config -> realtime),
// or from VITE_REALTIME_URL / VITE_REALTIME_PATH when the website is built.
import { io } from "socket.io-client";
import { AuthError, authConfig, realtimeTicket } from "./api";

const GRACE_MS = 3000;                         // keep the connection briefly when switching pages
const RETRY_MS = [2000, 5000, 10000, 30000];   // after the server refused the connection

let socket = null;
let starting = null;
let status = "idle";
let signedOut = false;
let retries = 0;
let retryTimer = null;
let idleTimer = null;
let connectedOnce = false;
let gen = 0; // bumped by stop(), so a connection still being set up is dropped

const topics = new Map();   // topic -> number of subscribers
const handlers = new Map(); // event -> Set(handler)
const statusListeners = new Set();
const reconnectListeners = new Set();

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((fn) => fn(status));
}

async function connect() {
  if (socket || starting) return starting;
  signedOut = false;
  const myGen = gen;
  starting = (async () => {
    setStatus("connecting");
    const cfg = ((await authConfig().catch(() => null)) || {}).realtime || {};
    if (myGen !== gen) return; // stop() was called meanwhile
    if (cfg.enabled === false) { setStatus("off"); return; }
    const url = import.meta.env.VITE_REALTIME_URL || cfg.url || undefined; // undefined = this website
    const path = import.meta.env.VITE_REALTIME_PATH || cfg.path || "/socket.io";

    socket = io(url, {
      path,
      reconnectionDelayMax: 10000,
      // A fresh ticket for every (re)connect, fetched with the normal sign-in cookies.
      auth: (cb) => {
        realtimeTicket()
          .then((r) => cb({ ticket: r.ticket }))
          .catch((err) => { if (err instanceof AuthError) signedOut = true; cb({}); });
      },
    });

    socket.on("connect", () => {
      retries = 0;
      setStatus("live");
      for (const topic of topics.keys()) socket.emit("subscribe", topic);
      if (connectedOnce) reconnectListeners.forEach((fn) => fn());
      connectedOnce = true;
    });
    socket.on("disconnect", (reason) => {
      setStatus("offline");
      // The server closed it on purpose (signed out / account changed): don't come back on our own.
      if (reason === "io server disconnect") signedOut = true;
    });
    socket.on("connect_error", () => {
      setStatus("offline");
      // Refused by the server (e.g. ticket expired while the laptop slept): try again, slowly.
      if (!socket.active && !signedOut) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => socket && socket.connect(), RETRY_MS[Math.min(retries++, RETRY_MS.length - 1)]);
      }
    });
    socket.onAny((event, data) => {
      const set = handlers.get(event);
      if (set) set.forEach((fn) => { try { fn(data); } catch (err) { console.error("[realtime]", err); } });
    });
  })().finally(() => { starting = null; });
  return starting;
}

/** Close the connection (sign-out, or nobody listening any more). */
export function stop() {
  gen += 1;
  clearTimeout(retryTimer);
  clearTimeout(idleTimer);
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  socket = null;
  connectedOnce = false;
  retries = 0;
  setStatus("idle");
}

/** Listen to `event` on `topic`. Returns a function that stops listening. */
export function subscribe(topic, event, handler) {
  clearTimeout(idleTimer);
  const count = topics.get(topic) || 0;
  topics.set(topic, count + 1);
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);

  if (!socket) connect();
  else if (count === 0 && socket.connected) socket.emit("subscribe", topic);

  return () => {
    const set = handlers.get(event);
    if (set) { set.delete(handler); if (!set.size) handlers.delete(event); }
    const left = (topics.get(topic) || 1) - 1;
    if (left > 0) { topics.set(topic, left); return; }
    topics.delete(topic);
    if (socket && socket.connected) socket.emit("unsubscribe", topic);
    if (!topics.size) idleTimer = setTimeout(stop, GRACE_MS);
  };
}

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
export function onReconnect(fn) {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}
export const getStatus = () => status;
