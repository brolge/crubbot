import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.InviteCreate,
  once: false,
  async execute(invite) {
    try {
      if (!invite.guild) return;
      await logEvent({
        client: invite.client,
        guildId: invite.guild.id,
        eventType: EVENT_TYPES.INVITE_CREATE,
        data: {
          title: 'Invite created',
          lines: [
            `**Code:** ${invite.code}`,
            `**Channel:** ${invite.channel || 'Unknown'}`,
            `**Inviter:** ${invite.inviter ? `${invite.inviter} (${invite.inviter.id})` : 'Unknown'}`,
            `**Max uses:** ${invite.maxUses || 'Unlimited'}`,
            `**Temporary:** ${invite.temporary ? 'Yes' : 'No'}`,
          ],
          userId: invite.inviter?.id,
          channelId: invite.channelId,
        },
      });
    } catch (error) {
      logger.error('Error in inviteCreate logging:', error);
    }
  },
};
