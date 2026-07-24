const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
const { baseEmbed } = require('../utils/embeds');
const { PANEL_PAGES: ALL_PANEL_PAGES } = require('./panel-pages');
const { freePanelPages } = require('../utils/edition');

function getPanelPages() {
  return freePanelPages(ALL_PANEL_PAGES);
}

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

function withThemeEmoji(button, guildId) {
  const theme = guildTheme(guildId);
  if (theme.emoji) {
    try {
      button.setEmoji(theme.emoji);
    } catch {
      /* ignore */
    }
  }
  return button;
}

function panelNav(page, total, guildId) {
  // Same style as action buttons — do NOT disable the page chip (Discord greys disabled buttons)
  const style = accentStyle(guildId);
  const row = new ActionRowBuilder();
  if (page > 0) {
    row.addComponents(
      withThemeEmoji(
        new ButtonBuilder().setCustomId(`panelnav:prev:${page}`).setLabel('Back').setStyle(style),
        guildId
      )
    );
  }
  row.addComponents(
    withThemeEmoji(
      new ButtonBuilder()
        .setCustomId('panelnav:noop')
        .setLabel(`${page + 1} / ${total}`)
        .setStyle(style),
      guildId
    )
  );
  if (page < total - 1) {
    row.addComponents(
      withThemeEmoji(
        new ButtonBuilder().setCustomId(`panelnav:next:${page}`).setLabel('Next').setStyle(style),
        guildId
      )
    );
  }
  return row;
}

function panelComponents(guildId, page = 0) {
  const pages = getPanelPages();
  const total = pages.length;
  const safePage = Math.max(0, Math.min(page, total - 1));
  const pageData = pages[safePage];
  const style = accentStyle(guildId);
  const rows = [];

  // Discord: max 5 buttons per row, max 5 rows (leave 1 for nav)
  const buttons = pageData.buttons || [];
  for (let i = 0; i < buttons.length && rows.length < 4; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        ...chunk.map((b) =>
          withThemeEmoji(
            new ButtonBuilder().setCustomId(`panel:${b.id}`).setLabel(b.label).setStyle(style),
            guildId
          )
        )
      )
    );
  }

  rows.push(panelNav(safePage, total, guildId));
  return rows;
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
  const options = items.slice(0, 25).map((t) => ({
    label: String(t.name || t.id).slice(0, 100),
    value: t.id,
    description: String(t.description || t.preview || t.id).slice(0, 100),
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`template:${kind}`)
      .setPlaceholder(kind === 'server' ? 'Choose channels & categories…' : 'Choose a role template…')
      .addOptions(options)
  );
}

function templateHomeComponents(guildId) {
  const { isFreeEdition } = require('../utils/edition');
  const style = accentStyle(guildId);
  if (isFreeEdition()) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('template:menu:server')
          .setLabel('Community layout (1 template)')
          .setStyle(style),
        new ButtonBuilder()
          .setCustomId('template:menu:end')
          .setLabel('Fix End Closer')
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('template:menu:server')
        .setLabel('Channels & Categories')
        .setStyle(style),
      new ButtonBuilder()
        .setCustomId('template:menu:roles')
        .setLabel('Roles')
        .setStyle(style),
      new ButtonBuilder()
        .setCustomId('template:menu:end')
        .setLabel('Fix End Closer')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function templateHomePayload(guildId) {
  const { isFreeEdition } = require('../utils/edition');
  if (isFreeEdition()) {
    return {
      embeds: [
        baseEmbed(guildId, {
          title: 'Templates · Free',
          description:
            '**Ougi Free** includes **one** server layout only (**Community Hub**).\n\n' +
            '→ Includes **tickets**: `#create-ticket` panel + **Buyer** priority tickets\n' +
            '→ Role templates are **Pro-only**\n' +
            '→ Extra layouts (gaming, aesthetic, creator…) are **Pro-only**\n\n' +
            'Use **Community layout** below, or **Fix End Closer**.',
        }),
      ],
      components: templateHomeComponents(guildId),
    };
  }
  return {
    embeds: [
      baseEmbed(guildId, {
        title: 'Templates',
        description:
          'Pick what you want to build:\n\n' +
          '→ **Channels & Categories** — full server layouts (community, aesthetic ★, gaming…)\n' +
          '→ **Roles** — staff ladders and rank packs\n' +
          '→ **Fix End Closer** — put `╰──── End 🔚` at the bottom\n\n' +
          'Then choose a template from the dropdown.',
      }),
    ],
    components: templateHomeComponents(guildId),
  };
}

function templatePickPayload(guildId, kind) {
  const { SERVER_TEMPLATES, ROLE_TEMPLATES } = require('../data/templates');
  const { isFreeEdition, freeServerTemplates } = require('../utils/edition');
  const isServer = kind === 'server';
  if (!isServer && isFreeEdition()) {
    return templateHomePayload(guildId);
  }
  const items = isServer
    ? freeServerTemplates(SERVER_TEMPLATES)
    : ROLE_TEMPLATES;
  return {
    embeds: [
      baseEmbed(guildId, {
        title: isServer
          ? isFreeEdition()
            ? 'Templates · Community (Free)'
            : 'Templates · Channels & Categories'
          : 'Templates · Roles',
        description:
          (isServer
            ? isFreeEdition()
              ? 'Free includes **Community Hub** only. Select it, then **Apply** or **Wipe + Apply**.'
              : 'Select a **server layout** from the dropdown. You’ll get a preview, then **Apply** or **Wipe + Apply**.'
            : 'Select a **role pack** from the dropdown. You’ll get a preview, then **Apply**.') +
          `\n\n_${items.length} template(s) available._`,
      }),
    ],
    components: [
      templateSelect(isServer ? 'server' : 'roles', items),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('template:menu:home')
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function templateApplyComponents(kind, id, _guildId) {
  if (kind === 'server') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`template:apply:server:${id}:keep`)
          .setLabel('Apply')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`template:apply:server:${id}:wipe`)
          .setLabel('Wipe + Apply')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('template:menu:server')
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`template:apply:roles:${id}`)
        .setLabel('Apply Role Template')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('template:menu:roles')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

module.exports = {
  get PANEL_PAGES() {
    return getPanelPages();
  },
  getPanelPages,
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
  templateHomeComponents,
  templateHomePayload,
  templatePickPayload,
  templateApplyComponents,
  accentStyle,
  themeNavStyle,
};
