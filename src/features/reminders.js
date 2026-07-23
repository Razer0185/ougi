const { loadGuild, saveGuild } = require('../utils/store');
const { successEmbed, errorEmbed, baseEmbed } = require('../utils/embeds');
const { parseDuration } = require('../utils/helpers');

const timers = new Map();

function ensureReminders(cfg) {
  if (!cfg.reminders || typeof cfg.reminders !== 'object') cfg.reminders = {};
  return cfg;
}

function scheduleReminder(client, reminder) {
  const delay = Math.max(0, reminder.endsAt - Date.now());
  clearTimeout(timers.get(reminder.id));
  const t = setTimeout(() => {
    fireReminder(client, reminder).catch(() => {});
  }, Math.min(delay, 2147483647));
  timers.set(reminder.id, t);
}

async function fireReminder(client, reminder) {
  const cfg = ensureReminders(loadGuild(reminder.guildId));
  delete cfg.reminders[reminder.id];
  saveGuild(reminder.guildId, cfg);
  timers.delete(reminder.id);

  const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
  if (channel?.isTextBased?.()) {
    await channel.send({
      content: `<@${reminder.userId}>`,
      embeds: [
        baseEmbed(reminder.guildId, {
          title: '⏰ Reminder',
          description: reminder.text,
          footer: 'Reminders',
        }),
      ],
    });
  }
}

function addReminder(client, { guildId, channelId, userId, text, durationMs }) {
  const cfg = ensureReminders(loadGuild(guildId));
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const reminder = {
    id,
    guildId,
    channelId,
    userId,
    text: String(text).slice(0, 1000),
    endsAt: Date.now() + durationMs,
  };
  cfg.reminders[id] = reminder;
  saveGuild(guildId, cfg);
  scheduleReminder(client, reminder);
  return reminder;
}

async function resumeReminders(client) {
  for (const [guildId] of client.guilds.cache) {
    const cfg = ensureReminders(loadGuild(guildId));
    for (const r of Object.values(cfg.reminders)) {
      if (r.endsAt <= Date.now()) await fireReminder(client, r);
      else scheduleReminder(client, r);
    }
  }
}

module.exports = {
  addReminder,
  resumeReminders,
  parseDuration,
  successEmbed,
  errorEmbed,
};
