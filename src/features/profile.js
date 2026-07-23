const https = require('https');
const http = require('http');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { modal } = require('../ui/components');

/** userId -> { type: 'avatar'|'banner', expires: number, channelId } */
const pendingUploads = new Map();

function profileMenu() {
  return {
    embeds: [
      // guild id filled by caller
    ],
  };
}

function profileComponents() {
  return [
    {
      type: 1,
      components: [
        { type: 2, custom_id: 'profile:name', label: 'Change Name', style: 1, emoji: { name: '✏️' } },
        { type: 2, custom_id: 'profile:avatar-url', label: 'Avatar URL', style: 2, emoji: { name: '🔗' } },
        { type: 2, custom_id: 'profile:avatar-upload', label: 'Upload Avatar', style: 3, emoji: { name: '🖼️' } },
        { type: 2, custom_id: 'profile:banner-url', label: 'Banner URL', style: 2, emoji: { name: '🔗' } },
        { type: 2, custom_id: 'profile:banner-upload', label: 'Upload Banner', style: 3, emoji: { name: '🖼️' } },
      ],
    },
  ];
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'OugiBot/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchBuffer(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function setAvatarFromUrl(client, url) {
  const buf = await fetchBuffer(url);
  await client.user.setAvatar(buf);
}

async function setBannerFromUrl(client, url) {
  const buf = await fetchBuffer(url);
  await client.user.setBanner(buf);
}

async function setAvatarFromAttachment(client, attachment) {
  const buf = await fetchBuffer(attachment.url);
  await client.user.setAvatar(buf);
}

async function setBannerFromAttachment(client, attachment) {
  const buf = await fetchBuffer(attachment.url);
  await client.user.setBanner(buf);
}

function nameModal() {
  return modal('settings:botname', 'Rename Bot', [
    { id: 'name', label: 'New bot username', placeholder: 'Ougi', max: 32 },
  ]);
}

function urlModal(kind) {
  return modal(`profile:${kind}-url-submit`, kind === 'avatar' ? 'Set Avatar from URL' : 'Set Banner from URL', [
    {
      id: 'url',
      label: 'Direct image URL (png/jpg/webp/gif)',
      placeholder: 'https://...',
      max: 300,
    },
  ]);
}

function armUpload(userId, type, channelId) {
  pendingUploads.set(userId, { type, channelId, expires: Date.now() + 90_000 });
}

function peekPendingUpload(userId) {
  const pending = pendingUploads.get(userId);
  if (!pending) return null;
  if (Date.now() > pending.expires) {
    pendingUploads.delete(userId);
    return null;
  }
  return pending;
}

function clearPendingUpload(userId) {
  pendingUploads.delete(userId);
}

function takePendingUpload(userId) {
  const pending = peekPendingUpload(userId);
  if (!pending) return null;
  pendingUploads.delete(userId);
  return pending;
}

module.exports = {
  profileComponents,
  nameModal,
  urlModal,
  armUpload,
  peekPendingUpload,
  clearPendingUpload,
  takePendingUpload,
  setAvatarFromUrl,
  setBannerFromUrl,
  setAvatarFromAttachment,
  setBannerFromAttachment,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
