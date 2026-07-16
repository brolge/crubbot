export const LOG_DESTINATIONS = Object.freeze([
  'audit',
  'message',
  'member',
  'moderation',
  'channel',
  'role',
  'voice',
  'invite',
  'server',
  'reaction',
  'bot',
  'applications',
  'reports',
]);

export const LOG_DESTINATION_LABELS = Object.freeze({
  audit: 'Audit (fallback)',
  message: 'Message Logs',
  member: 'Member Logs',
  moderation: 'Moderation Logs',
  channel: 'Channel Logs',
  role: 'Role Logs',
  voice: 'Voice Logs',
  invite: 'Invite Logs',
  server: 'Server Logs',
  reaction: 'Reaction Logs',
  bot: 'Bot Logs',
  applications: 'Applications',
  reports: 'Reports',
});

export const LOG_DESTINATION_DESCRIPTIONS = Object.freeze({
  audit: 'Fallback when a specific route is unset',
  message: 'Message edits, deletes, and bulk deletes',
  member: 'Joins, leaves, and name changes',
  moderation: 'Bans, kicks, timeouts, warns, locks',
  channel: 'Channel create, update, and delete',
  role: 'Role create/update/delete and role give/remove',
  voice: 'Voice join, leave, and move',
  invite: 'Invite create and delete',
  server: 'Server setting updates',
  reaction: 'Reactions and reaction-role events',
  bot: 'Bot/system events (leveling, giveaways, anti-nuke)',
  applications: 'Application submissions and reviews',
  reports: 'User reports',
});

export const CATEGORY_DESTINATION = Object.freeze({
  moderation: 'moderation',
  message: 'message',
  role: 'role',
  member: 'member',
  channel: 'channel',
  voice: 'voice',
  invite: 'invite',
  server: 'server',
  reaction: 'reaction',
  reactionrole: 'reaction',
  leveling: 'bot',
  giveaway: 'bot',
  counter: 'bot',
  security: 'bot',
  application: 'applications',
  report: 'reports',
});

export function isLogDestination(destination) {
  return LOG_DESTINATIONS.includes(destination);
}

export function resolveEventLogChannelId(config, eventType, overrideChannelId = null) {
  if (overrideChannelId) return overrideChannelId;

  const channels = config?.logging?.channels || {};
  const eventChannels = config?.logging?.eventChannels || {};

  if (eventType && typeof eventChannels[eventType] === 'string' && eventChannels[eventType]) {
    return eventChannels[eventType];
  }

  const category = typeof eventType === 'string' ? eventType.split('.')[0] : null;
  const destination = CATEGORY_DESTINATION[category] || 'audit';

  if (channels[destination]) return channels[destination];

  // Legacy fallback: everything used to dump into audit / logChannelId.
  return channels.audit
    ?? config?.logging?.channelId
    ?? config?.logChannelId
    ?? null;
}
