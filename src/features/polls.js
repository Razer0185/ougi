const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

async function createPoll(channel, guildId, question, options) {
  const opts = options.slice(0, 10);
  if (opts.length < 2) throw new Error('Need at least 2 options.');
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const body = opts.map((o, i) => `${emojis[i]} ${o}`).join('\n');
  const msg = await channel.send({
    embeds: [
      baseEmbed(guildId, {
        title: '📊 Poll',
        description: `**${question}**\n\n${body}`,
        footer: 'Poll',
      }),
    ],
  });
  for (let i = 0; i < opts.length; i++) {
    await msg.react(emojis[i]).catch(() => {});
  }
  return msg;
}

module.exports = { createPoll, successEmbed, errorEmbed };
