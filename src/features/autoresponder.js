const { loadGuild, saveGuild } = require('../utils/store');

function ensureAuto(cfg) {
  if (!cfg.autoresponder || typeof cfg.autoresponder !== 'object') {
    cfg.autoresponder = { enabled: true, rules: [] };
  }
  if (!Array.isArray(cfg.autoresponder.rules)) cfg.autoresponder.rules = [];
  return cfg;
}

function addRule(guildId, trigger, response, mode = 'contains') {
  const cfg = ensureAuto(loadGuild(guildId));
  cfg.autoresponder.rules.push({
    id: Date.now().toString(36),
    trigger: String(trigger).toLowerCase(),
    response: String(response).slice(0, 2000),
    mode: mode === 'exact' ? 'exact' : 'contains',
  });
  saveGuild(guildId, cfg);
  return cfg.autoresponder.rules;
}

function removeRule(guildId, idOrTrigger) {
  const cfg = ensureAuto(loadGuild(guildId));
  const q = String(idOrTrigger).toLowerCase();
  const before = cfg.autoresponder.rules.length;
  cfg.autoresponder.rules = cfg.autoresponder.rules.filter(
    (r) => r.id !== idOrTrigger && r.trigger !== q
  );
  saveGuild(guildId, cfg);
  return before - cfg.autoresponder.rules.length;
}

function listRules(guildId) {
  return ensureAuto(loadGuild(guildId)).autoresponder.rules;
}

async function maybeAutorespond(message) {
  if (!message.guild || message.author.bot || !message.content) return;
  const cfg = ensureAuto(loadGuild(message.guild.id));
  if (!cfg.autoresponder.enabled) return;
  const text = message.content.toLowerCase();
  for (const rule of cfg.autoresponder.rules) {
    const hit =
      rule.mode === 'exact' ? text === rule.trigger : text.includes(rule.trigger);
    if (hit) {
      await message.channel.send(rule.response).catch(() => {});
      return;
    }
  }
}

module.exports = { ensureAuto, addRule, removeRule, listRules, maybeAutorespond };
