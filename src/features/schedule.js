'use strict';

/**
 * Scheduled / repeating channel announcements.
 */

const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

const timers = new Map(); // `${guildId}:${jobId}` -> timeout

function ensureSchedule(cfg) {
  if (!cfg.schedules || typeof cfg.schedules !== 'object') {
    cfg.schedules = {};
  }
  return cfg.schedules;
}

function parseEvery(raw) {
  const s = String(raw || '').toLowerCase().trim();
  const m = s.match(/^(\d+)\s*(m|min|mins|h|hr|hours|d|day|days)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = m[2][0];
  if (u === 'm') return Math.max(1, n) * 60_000;
  if (u === 'h') return Math.max(1, n) * 3_600_000;
  if (u === 'd') return Math.max(1, n) * 86_400_000;
  return null;
}

function scheduleJob(client, guildId, jobId, job) {
  const key = `${guildId}:${jobId}`;
  if (timers.has(key)) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }
  const delay = Math.max(5_000, (job.nextAt || Date.now()) - Date.now());
  const t = setTimeout(async () => {
    timers.delete(key);
    try {
      await runJob(client, guildId, jobId);
    } catch (err) {
      console.error('Schedule job failed:', err.message);
    }
  }, delay);
  if (typeof t.unref === 'function') t.unref();
  timers.set(key, t);
}

async function runJob(client, guildId, jobId) {
  const cfg = loadGuild(guildId);
  const jobs = ensureSchedule(cfg);
  const job = jobs[jobId];
  if (!job || !job.enabled) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const channel = await guild.channels.fetch(job.channelId).catch(() => null);
  if (channel?.isTextBased?.()) {
    await channel
      .send({
        embeds: [
          baseEmbed(guildId, {
            title: job.title || 'Scheduled',
            description: job.message,
            footer: 'Scheduled announcement',
          }),
        ],
      })
      .catch(() => {});
  }

  job.nextAt = Date.now() + (job.everyMs || 86_400_000);
  saveGuild(guildId, cfg);
  scheduleJob(client, guildId, jobId, job);
}

function addSchedule(guildId, { channelId, everyMs, message, title }) {
  const cfg = loadGuild(guildId);
  const jobs = ensureSchedule(cfg);
  const id = `s${Date.now().toString(36)}`;
  jobs[id] = {
    id,
    enabled: true,
    channelId,
    everyMs,
    message: String(message).slice(0, 2000),
    title: (title || 'Announcement').slice(0, 100),
    nextAt: Date.now() + everyMs,
  };
  saveGuild(guildId, cfg);
  return jobs[id];
}

function removeSchedule(guildId, jobId) {
  const cfg = loadGuild(guildId);
  const jobs = ensureSchedule(cfg);
  const key = `${guildId}:${jobId}`;
  if (timers.has(key)) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }
  const had = !!jobs[jobId];
  delete jobs[jobId];
  saveGuild(guildId, cfg);
  return had;
}

function listSchedules(guildId) {
  return Object.values(ensureSchedule(loadGuild(guildId)));
}

async function resumeSchedules(client) {
  for (const [guildId] of client.guilds.cache) {
    const jobs = ensureSchedule(loadGuild(guildId));
    for (const job of Object.values(jobs)) {
      if (job.enabled) scheduleJob(client, guildId, job.id, job);
    }
  }
}

function armSchedule(client, guildId, job) {
  scheduleJob(client, guildId, job.id, job);
}

module.exports = {
  parseEvery,
  addSchedule,
  removeSchedule,
  listSchedules,
  resumeSchedules,
  armSchedule,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
