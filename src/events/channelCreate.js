import { Events, ChannelType } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

function channelLabel(channel) {
  if (!channel) return 'Unknown';
  if (channel.type === ChannelType.GuildCategory) return `category ${channel.name}`;
  return `${channel}`;
}

export default {
  name: Events.ChannelCreate,
  once: false,
  async execute(channel) {
    try {
      if (!channel.guild) return;
      await logEvent({
        client: channel.client,
        guildId: channel.guild.id,
        eventType: EVENT_TYPES.CHANNEL_CREATE,
        data: {
          title: 'Channel created',
          lines: [
            `**Channel:** ${channelLabel(channel)}`,
            `**ID:** ${channel.id}`,
            `**Type:** ${ChannelType[channel.type] || channel.type}`,
          ],
          channelId: channel.id,
        },
      });
    } catch (error) {
      logger.error('Error in channelCreate logging:', error);
    }
  },
};
