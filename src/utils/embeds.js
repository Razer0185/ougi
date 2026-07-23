const { EmbedBuilder } = require('discord.js');
const { getTheme } = require('./theme');
const { loadGuild } = require('./store');

function themeFor(guildId) {
  const cfg = guildId ? loadGuild(guildId) : { theme: 'blue' };
  return getTheme(cfg.theme);
}

function applyChrome(embed, guildId, options = {}) {
  const theme = themeFor(guildId);
  embed.setColor(theme.color).setTimestamp();

  if (!options.author && options.branded !== false) {
    embed.setAuthor({ name: 'Ougi' });
  } else if (options.author) {
    embed.setAuthor(options.author);
  }

  if (options.footer) {
    embed.setFooter({
      text: typeof options.footer === 'string' ? options.footer : options.footer.text,
      iconURL: options.footer.iconURL,
    });
  }

  return { embed, theme };
}

function baseEmbed(guildId, options = {}) {
  const embed = new EmbedBuilder();
  applyChrome(embed, guildId, options);

  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.fields) embed.addFields(options.fields);

  return embed;
}

function rulesStyleList(items) {
  return items
    .map((item) => {
      if (typeof item === 'string') return `• ${item}`;
      return `• **${item.label}:** ${item.text}`;
    })
    .join('\n');
}

function successEmbed(guildId, title, description) {
  return baseEmbed(guildId, {
    title: `✓ ${title}`,
    description: description || undefined,
  });
}

function errorEmbed(guildId, title, description) {
  return baseEmbed(guildId, {
    title: `✕ ${title}`,
    description: description || undefined,
  });
}

function infoEmbed(guildId, title, description) {
  return baseEmbed(guildId, {
    title,
    description: description || undefined,
  });
}

function panelEmbed(guildId, client, page = 0) {
  const { PANEL_PAGES } = require('../ui/components');
  const total = PANEL_PAGES.length;
  const safePage = Math.max(0, Math.min(page, total - 1));
  const pageData = PANEL_PAGES[safePage];
  const prefix = require('./store').getGuildPrefix(guildId);

  const actionLines = pageData.buttons.map((b) => `**${b.label}** - ${b.hint || 'open'}`).join('\n');

  return baseEmbed(guildId, {
    title: pageData.title,
    description: `${pageData.blurb}\n\n${actionLines}\n\nUse the buttons below. Prefix is \`${prefix}\`.`,
    thumbnail: client?.user?.displayAvatarURL({ size: 256 }),
    footer: `Page ${safePage + 1} of ${total}`,
  });
}

module.exports = {
  baseEmbed,
  rulesStyleList,
  successEmbed,
  errorEmbed,
  infoEmbed,
  panelEmbed,
  themeFor,
};
