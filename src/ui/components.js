const {
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const { getTheme, themeButtonStyle } = require('../utils/theme');
const { loadGuild } = require('../utils/store');
const { PANEL_PAGES } = require('./panel-pages');

function guildTheme(guildId) {
  return getTheme(guildId ? loadGuild(guildId).theme : 'blue');
}

/** All interactive chrome uses the active interface color mapping. */
function accentStyle(guildId) {
  return themeButtonStyle(guildTheme(guildId));
}

function themeNavStyle(guildId) {
  return themeButtonStyle(guildTheme(guildId));
}

function styleFor(_kind, guildId) {
  // Keep every panel button on the chosen theme color
  return accentStyle(guildId);
}

function panelNav(page, total, guildId) {
  const navStyle = themeNavStyle(guildId);
  const row = new ActionRowBuilder();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`panelnav:prev:${page}`).setLabel('Back').setStyle(navStyle)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('panelnav:noop')
      .setLabel(`${page + 1} / ${total}`)
      .setStyle(navStyle)
      .setDisabled(true)
  );
  if (page < total - 1) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`panelnav:next:${page}`).setLabel('Next').setStyle(navStyle)
    );
  }
  return row;
}

function panelComponents(guildId, page = 0) {
  const total = PANEL_PAGES.length;
  const safePage = Math.max(0, Math.min(page, total - 1));
  const pageData = PANEL_PAGES[safePage];
  const style = accentStyle(guildId);

  const actionRow = new ActionRowBuilder().addComponents(
    ...pageData.buttons.map((b) =>
      new ButtonBuilder().setCustomId(`panel:${b.id}`).setLabel(b.label).setStyle(style)
    )
  );

  return [actionRow, panelNav(safePage, total, guildId)];
}

/** @deprecated use panelComponents(guildId, page) */
function panelComponentsLegacy() {
  return panelComponents(null, 0);
}

function userPickRow(action) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`pickuser:${action}`)
      .setPlaceholder(`Select a member · ${action}`)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function themeSelect() {
  const { INTERFACE_TEMPLATES } = require('../utils/theme');
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('settings:theme')
      .setPlaceholder('Choose interface color')
      .addOptions(
        INTERFACE_TEMPLATES.map((t) => ({
          label: t.label,
          value: t.id,
          description: `Accent ${t.accent}`,
        }))
      )
  );
}

function helpNav(page, total, guildId) {
  const navStyle = themeNavStyle(guildId);
  const row = new ActionRowBuilder();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`help:prev:${page}`).setLabel('Back').setStyle(navStyle)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('help:noop')
      .setLabel(`${page + 1} / ${total}`)
      .setStyle(navStyle)
      .setDisabled(true)
  );
  if (page < total - 1) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`help:next:${page}`).setLabel('Next').setStyle(navStyle)
    );
  }
  return [row];
}

function modal(id, title, fields) {
  const m = new ModalBuilder().setCustomId(id).setTitle(title);
  const rows = fields.map((f) => {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(f.style === 'long' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required !== false);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    if (f.max) input.setMaxLength(f.max);
    if (f.value) input.setValue(f.value);
    return new ActionRowBuilder().addComponents(input);
  });
  m.addComponents(...rows.slice(0, 5));
  return m;
}

function channelPick(customId, placeholder, types) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);
  const list = types || [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  menu.addChannelTypes(...list);
  return new ActionRowBuilder().addComponents(menu);
}

function lockChannelPick(action) {
  return channelPick(`channellock:${action}`, `Pick a channel to ${action} · or use #name`, [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildForum,
    ChannelType.GuildStageVoice,
  ]);
}

function nukeChannelPick() {
  return channelPick('channellock:nuke', 'Pick a channel to nuke · or use #name', [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ]);
}

function templateSelect(kind, items) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`template:${kind}`)
      .setPlaceholder(`Choose a ${kind} template`)
      .addOptions(
        items.map((t) => ({
          label: t.name,
          value: t.id,
          description: t.description.slice(0, 100),
        }))
      )
  );
}

module.exports = {
  PANEL_PAGES,
  panelComponents,
  panelComponentsLegacy,
  userPickRow,
  themeSelect,
  helpNav,
  modal,
  channelPick,
  lockChannelPick,
  nukeChannelPick,
  templateSelect,
  accentStyle,
  themeNavStyle,
};
