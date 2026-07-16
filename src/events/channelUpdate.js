import { Events, ChannelType } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ChannelUpdate,
  once: false,
  async execute(oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;

      const changes = [];
      if (oldChannel.name !== newChannel.name) {
        changes.push(`**Name:** ${oldChannel.name} → ${newChannel.name}`);
      }
      if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic) {
        changes.push(`**Topic:** ${oldChannel.topic || '(none)'} → ${newChannel.topic || '(none)'}`);
      }
      if ('nsfw' in oldChannel && oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`**NSFW:** ${oldChannel.nsfw} → ${newChannel.nsfw}`);
      }
      if ('rateLimitPerUser' in oldChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`**Slowmode:** ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
      }
      if ('parentId' in oldChannel && oldChannel.parentId !== newChannel.parentId) {
        changes.push(`**Category:** ${oldChannel.parentId || 'none'} → ${newChannel.parentId || 'none'}`);
      }

      if (!changes.length) return;

      await logEvent({
        client: newChannel.client,
        guildId: newChannel.guild.id,
        eventType: EVENT_TYPES.CHANNEL_UPDATE,
        data: {
          title: 'Channel updated',
          lines: [
            `**Channel:** ${newChannel.type === ChannelType.GuildCategory ? newChannel.name : newChannel}`,
            `**ID:** ${newChannel.id}`,
            ...changes,
          ],
          channelId: newChannel.id,
        },
      });
    } catch (error) {
      logger.error('Error in channelUpdate logging:', error);
    }
  },
};
