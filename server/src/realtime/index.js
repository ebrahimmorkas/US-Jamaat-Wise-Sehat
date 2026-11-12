// Live updates over Socket.IO, for any part of the system.
//
//   Server side
//     registerTopic("dashboard", { roles: ["saheb"] })    who may listen to a topic
//     publish("dashboard", "dashboard:changed", { month })  tell everyone listening
//     sendToUser(userId, "event", data) / sendToRole("jc", "event", data)
//     disconnectSession(sessionId) / disconnectUser(userId)  after logout / account changes
//     notifyOnSuccess(topic, event, data)                   Express middleware: publish after a
//                                                           successful POST/PUT/PATCH/DELETE
//   Browser side: client/src/lib/realtime.js  (subscribe(topic, event, handler))
//
// Messages carry only "what changed" (no personal data): the page reloads its data through
// the normal API, so the usual role and access checks still apply.
const { Server } = require("socket.io");
const config = require("../config");
const { isDbReady } = require("../db");
const User = require("../models/User");
const Session = require("../models/Session");
const { verifySocketTicket } = require("../services/auth");

let io = null;
const topics = new Map(); // name -> { roles: [..] | null, authorize?: (user, name) => bool }

const room = {
  topic: (name) => `topic:${name}`,
  user: (id) => `user:${id}`,
  role: (role) => `role:${role}`,
  session: (sid) => `session:${sid}`,
};

/**
 * Declares a topic browsers may subscribe to.
 *   roles:     roles allowed (omit = every signed-in user)
 *   authorize: optional extra check (user, topicName) => true/false (may be async)
 */
function registerTopic(name, { roles, authorize } = {}) {
  topics.set(name, { roles: roles && roles.length ? roles : null, authorize });
}

async function mayJoin(user, name) {
  const t = topics.get(name);
  if (!t) return false;
  if (t.roles && !t.roles.includes(user.role)) return false;
  if (t.authorize) return !!(await t.authorize(user, name));
  return true;
}

// Only our own website may open a live connection.
function originAllowed(req) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  if (!origin) return !config.isProduction; // tools / tests on this computer
  const own = [`http://${req.headers.host}`, `https://${req.headers.host}`];
  return config.corsOrigins.includes(origin) || own.includes(origin);
}

// Sign-in check for every connection (and every reconnect): a fresh ticket from
// POST /api/realtime/ticket, a live session and an active account.
async function authenticate(socket, next) {
  const fail = (code) => {
    const err = new Error(code);
    err.data = { code };
    next(err);
  };
  try {
    const ticket = socket.handshake.auth && socket.handshake.auth.ticket;
    if (!ticket) return fail("NO_TICKET");
    let payload;
    try {
      payload = verifySocketTicket(ticket);
    } catch {
      return fail("TICKET_INVALID");
    }
    if (!isDbReady()) return fail("DB_UNAVAILABLE");
    const [session, user] = await Promise.all([
      Session.findById(payload.sid).select("revokedAt expiresAt user").lean(),
      User.findById(payload.sub).select("email name role isActive").lean(),
    ]);
    if (!session || session.revokedAt || session.expiresAt < new Date() || String(session.user) !== payload.sub) return fail("SESSION_ENDED");
    if (!user || !user.isActive || !user.email) return fail("USER_INACTIVE");
    socket.data.user = { id: String(user._id), email: user.email, role: user.role };
    socket.data.sessionId = String(payload.sid);
    next();
  } catch (err) {
    console.warn("[realtime] connection check failed:", err.message);
    fail("SERVER_ERROR");
  }
}

function onConnection(socket) {
  const { user, sessionId } = socket.data;
  socket.join([room.user(user.id), room.role(user.role), room.session(sessionId)]);

  // socket.emit("subscribe", "dashboard", (reply) => ...)  reply = { ok } or { ok:false, error }
  socket.on("subscribe", async (name, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (typeof name !== "string" || name.length > 100) return reply({ ok: false, error: "BAD_TOPIC" });
    try {
      if (!(await mayJoin(user, name))) return reply({ ok: false, error: "FORBIDDEN" });
      socket.join(room.topic(name));
      reply({ ok: true });
    } catch {
      reply({ ok: false, error: "SERVER_ERROR" });
    }
  });
  socket.on("unsubscribe", (name, ack) => {
    if (typeof name === "string") socket.leave(room.topic(name));
    if (typeof ack === "function") ack({ ok: true });
  });
}

/** Starts Socket.IO on the HTTP server (call once, before listen). */
function init(httpServer) {
  if (!config.realtime.enabled) {
    console.log("[realtime] live updates are turned off (REALTIME_ENABLED=false)");
    return null;
  }
  io = new Server(httpServer, {
    path: config.realtime.path,
    serveClient: false,
    cors: { origin: config.corsOrigins, methods: ["GET", "POST"] },
    allowRequest: (req, cb) => cb(null, originAllowed(req)),
    pingInterval: config.realtime.pingIntervalSeconds * 1000,
    maxHttpBufferSize: 10 * 1024, // browsers only send tiny "subscribe" messages
  });
  io.use(authenticate);
  io.on("connection", onConnection);
  console.log(`[realtime] live updates on ${config.realtime.path}`);
  return io;
}

const stamp = (data) => ({ ...(data || {}), at: new Date().toISOString() });

/** Sends `event` to everyone subscribed to `topic`. */
function publish(topic, event, data) {
  if (io) io.to(room.topic(topic)).emit(event, stamp(data));
}
function sendToUser(userId, event, data) {
  if (io) io.to(room.user(String(userId))).emit(event, stamp(data));
}
function sendToRole(role, event, data) {
  if (io) io.to(room.role(role)).emit(event, stamp(data));
}
/** Closes live connections of a session (logout) or of a user (deactivated, role changed, deleted). */
function disconnectSession(sessionId) {
  if (io && sessionId) io.in(room.session(String(sessionId))).disconnectSockets(true);
}
function disconnectUser(userId) {
  if (io && userId) io.in(room.user(String(userId))).disconnectSockets(true);
}

/**
 * Express middleware: after a successful change request (POST/PUT/PATCH/DELETE, status < 400),
 * publishes `event` on `topic`. `data` may be an object or (req) => object.
 */
const notifyOnSuccess = (topic, event, data) => (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode < 400) publish(topic, event, typeof data === "function" ? data(req) : data);
  });
  next();
};

/** What the website needs to connect (sent with /api/auth/config). */
const clientConfig = () => ({
  enabled: !!config.realtime.enabled,
  url: config.realtime.publicUrl,
  path: config.realtime.path,
});

const close = () => (io ? new Promise((resolve) => io.close(() => resolve())) : Promise.resolve());

module.exports = {
  init, close, registerTopic, publish, sendToUser, sendToRole,
  disconnectSession, disconnectUser, notifyOnSuccess, clientConfig,
};
