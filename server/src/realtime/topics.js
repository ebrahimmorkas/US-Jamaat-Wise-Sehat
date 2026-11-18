// The live-update topics of this system and who may listen to them.
// To add one: give it a name here, register who may subscribe, and call
// realtime.publish(TOPICS.x, EVENTS.y, {...}) where the data changes.
const { registerTopic } = require("./index");

const TOPICS = {
  dashboard: "dashboard", // anything the Saheb dashboard shows
  portal: "portal",       // anything the JC dashboard (JC portal) shows
};

const EVENTS = {
  dashboardChanged: "dashboard:changed", // { reason: "entry"|"masters"|"fields"|"lists", month? }
  portalChanged: "portal:changed",       // { reason: "entry"|"masters"|"fields"|"access", month?, jamaat? (id) }
  statsChanged: "stats:changed",         // the Super Admin uploaded / removed a Stats image (dashboard + portal topics)
  metricsChanged: "metrics:changed",     // a JC added / changed / removed a metric (dashboard topic)
};

registerTopic(TOPICS.dashboard, { roles: ["saheb"] });
registerTopic(TOPICS.portal, { roles: ["jc"] });

module.exports = { TOPICS, EVENTS };
