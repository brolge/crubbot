import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.InviteDelete,
  once: false,
  async execute(invite) {
    try {
      if (!invite.guild) return;
      await logEvent({
        client: invite.client,
        guildId: invite.guild.id,
        eventType: EVENT_TYPES.INVITE_DELETE,
        data: {
          title: 'Invite deleted',
          lines: [
            `**Code:** ${invite.code}`,
            `**Channel:** ${invite.channel || 'Unknown'}`,
          ],
          channelId: invite.channelId,
        },
      });
    } catch (error) {
      logger.error('Error in inviteDelete logging:', error);
    }
  },
};
