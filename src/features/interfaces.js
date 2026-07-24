const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const path = require('path');
const {
  INTERFACE_TEMPLATES,
  findPreviewFile,
  ensureAssetsDir,
  getInterface,
  themeButtonStyle,
} = require('../utils/theme');
const { loadGuild } = require('../utils/store');

ensureAssetsDir();

function interfaceEmbed(guildId, template, pageIndex, total) {
  const cfg = loadGuild(guildId);
  const active = cfg.theme === template.id;
  const file = findPreviewFile(template.id);
  const embed = new EmbedBuilder()
    .setColor(template.color)
    .setAuthor({ name: `${template.emoji} ★ Ougi · ${template.label}` })
    .setTitle(`Interface · ${template.label}`)
    .setDescription(
      active
        ? `**Currently active** on this server.\n\nAll embeds + buttons use this color.`
        : `Preview for the **${template.label}** interface.\n\n` +
          (file
            ? 'Preview image attached below.'
            : `\`\`\`\n${template.label.toUpperCase()}\n\`\`\`\n` +
              '_Placeholder — add_ ' +
              `\`${template.id}.png\` _to unlock preview_`)
    )
    .setFooter({ text: `${pageIndex + 1}/${total} · assets/interfaces/${template.id}.png` })
    .setTimestamp();

  const files = [];
  if (file) {
    const name = path.basename(file);
    files.push(new AttachmentBuilder(file, { name }));
    embed.setImage(`attachment://${name}`);
  }

  return { embed, files };
}

function interfaceNav(page, total, guildId) {
  const { themeNavStyle, accentStyle } = require('../ui/components');
  const navStyle = themeNavStyle(guildId);
  const row = new ActionRowBuilder();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`iface:prev:${page}`)
        .setLabel('Back')
        .setStyle(navStyle)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('iface:noop')
      .setLabel(`${page + 1} / ${total}`)
      .setStyle(accentStyle(guildId))
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`iface:apply:${INTERFACE_TEMPLATES[page].id}`)
      .setLabel(`Use ${INTERFACE_TEMPLATES[page].label}`)
      .setStyle(themeButtonStyle(INTERFACE_TEMPLATES[page]))
  );
  if (page < total - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`iface:next:${page}`)
        .setLabel('Next')
        .setStyle(navStyle)
    );
  }
  return [row];
}

function interfaceSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('iface:pick')
      .setPlaceholder('Jump to an interface color')
      .addOptions(
        INTERFACE_TEMPLATES.map((t) => ({
          label: t.label,
          value: t.id,
          description: `Apply the ${t.label} interface theme`,
        }))
      )
  );
}

function allInterfacesPayload(guildId) {
  // Discord allows up to 10 embeds per message — perfect for all 10 templates
  const embeds = [];
  const files = [];
  const cfg = loadGuild(guildId);

  for (const t of INTERFACE_TEMPLATES) {
    const file = findPreviewFile(t.id);
    const embed = new EmbedBuilder()
      .setColor(t.color)
      .setTitle(t.label)
      .setDescription(
        cfg.theme === t.id
          ? '**Active**'
          : file
            ? 'Preview ready'
            : `\`\`\`${t.label.toUpperCase()}\`\`\`\n_Add \`${t.id}.png\` to unlock preview_`
      );
    if (file) {
      const name = `${t.id}${path.extname(file)}`;
      files.push(new AttachmentBuilder(file, { name }));
      embed.setImage(`attachment://${name}`);
    }
    embeds.push(embed);
  }

  return { embeds, files, components: [interfaceSelect()] };
}

function singleInterfacePayload(guildId, page) {
  const template = INTERFACE_TEMPLATES[page];
  const { embed, files } = interfaceEmbed(guildId, template, page, INTERFACE_TEMPLATES.length);
  return {
    embeds: [embed],
    files,
    components: [...interfaceNav(page, INTERFACE_TEMPLATES.length, guildId), interfaceSelect()],
  };
}

module.exports = {
  interfaceEmbed,
  interfaceNav,
  interfaceSelect,
  allInterfacesPayload,
  singleInterfacePayload,
  INTERFACE_TEMPLATES,
  getInterface,
};
