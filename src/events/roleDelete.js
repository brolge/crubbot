import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditLines } from '../utils/logEmbeds.js';
import { handleRoleDeletion } from '../services/lockdownService.js';

export default {
  name: Events.GuildRoleDelete,
  once: false,

  async execute(role) {
    try {
      if (!role.guild) return;

      try {
        await handleRoleDeletion(role.client, role);
      } catch (error) {
        logger.error(`Anti-nuke role deletion handling failed for guild ${role.guild.id}:`, error);
      }

      const lines = buildRoleAuditLines(role, { includeMemberCount: true });

      await logEvent({
        client: role.client,
        guildId: role.guild.id,
        eventType: EVENT_TYPES.ROLE_DELETE,
        data: {
          title: 'Role Deleted',
          headline: `**${role.name}** was deleted`,
          lines,
        },
      });

    } catch (error) {
      logger.error('Error in roleDelete event:', error);
    }
  }
};
