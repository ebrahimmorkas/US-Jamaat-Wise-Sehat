// The live-update topics of this system and who may listen to them.
// To add one: give it a name here, register who may subscribe, and call
// realtime.publish(TOPICS.x, EVENTS.y, {...}) where the data changes.
const { registerTopic } = require("./index");

const TOPICS = {
  dashboard: "dashboard", // anything the Saheb dashboard shows
};

const EVENTS = {
  dashboardChanged: "dashboard:changed", // { reason: "entry"|"masters"|"fields"|"lists", month? }
};

registerTopic(TOPICS.dashboard, { roles: ["saheb"] });

module.exports = { TOPICS, EVENTS };
