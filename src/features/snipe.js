'use strict';

/**
 * Snipe — last deleted (and edited) messages per channel for mods.
 */

const MAX_PER_CHANNEL = 10;
const deletes = new Map(); // channelId -> entries[]
const edits = new Map();

function push(map, channelId, entry) {
  const arr = map.get(channelId) || [];
  arr.unshift(entry);
  if (arr.length > MAX_PER_CHANNEL) arr.length = MAX_PER_CHANNEL;
  map.set(channelId, arr);
}

function cacheDelete(message) {
  if (!message?.guild || !message.channel || message.author?.bot) return;
  const content = message.content || '';
  const attach = [...(message.attachments?.values?.() || [])].map((a) => a.url);
  if (!content && !attach.length && !message.embeds?.length) return;
  push(deletes, message.channel.id, {
    content: content.slice(0, 1900),
    authorId: message.author?.id,
    authorTag: message.author?.tag || 'Unknown',
    avatar: message.author?.displayAvatarURL?.({ size: 128 }) || null,
    at: Date.now(),
    attachments: attach.slice(0, 4),
  });
}

function cacheEdit(oldMessage, newMessage) {
  if (!oldMessage?.guild || !oldMessage.channel || oldMessage.author?.bot) return;
  const before = oldMessage.content || '';
  const after = newMessage?.content || '';
  if (!before || before === after) return;
  push(edits, oldMessage.channel.id, {
    before: before.slice(0, 900),
    after: after.slice(0, 900),
    authorId: oldMessage.author?.id,
    authorTag: oldMessage.author?.tag || 'Unknown',
    avatar: oldMessage.author?.displayAvatarURL?.({ size: 128 }) || null,
    at: Date.now(),
  });
}

function getSnipe(channelId, index = 0) {
  const arr = deletes.get(channelId) || [];
  return arr[index] || null;
}

function getEditSnipe(channelId, index = 0) {
  const arr = edits.get(channelId) || [];
  return arr[index] || null;
}

module.exports = {
  cacheDelete,
  cacheEdit,
  getSnipe,
  getEditSnipe,
};
