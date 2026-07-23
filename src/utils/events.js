/**
 * Parse event start time from user input.
 * "now" / "0" → ~2 minutes from now (Discord requires a future start).
 * Otherwise hours from now (min 0.02 ≈ now).
 */
function parseEventStart(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'now' || text === 'asap' || text === '0') {
    const start = new Date(Date.now() + 2 * 60 * 1000);
    return { start, label: 'starting now (~2 min)', immediate: true };
  }
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours < 0) {
    const start = new Date(Date.now() + 24 * 3600 * 1000);
    return { start, label: 'in 24 hours', immediate: false };
  }
  if (hours === 0) {
    const start = new Date(Date.now() + 2 * 60 * 1000);
    return { start, label: 'starting now (~2 min)', immediate: true };
  }
  const start = new Date(Date.now() + hours * 3600 * 1000);
  return {
    start,
    label: hours < 1 ? `in ${Math.round(hours * 60)} minutes` : `in ${hours} hour(s)`,
    immediate: false,
  };
}

module.exports = { parseEventStart };
