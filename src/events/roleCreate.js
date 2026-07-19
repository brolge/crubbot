import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditLines } from '../utils/logEmbeds.js';
import { enforceExternalAppRolePolicy } from '../services/lockdownService.js';

export default {
  name: Events.GuildRoleCreate,
  once: false,

  async execute(role) {
    try {
      if (!role.guild) return;

      await enforceExternalAppRolePolicy(role.client, role).catch((error) => {
        logger.error('External app role policy enforcement failed:', {
          guildId: role.guild.id,
          roleId: role.id,
          error: error.message,
        });
      });

      const lines = buildRoleAuditLines(role);

      await logEvent({
        client: role.client,
        guildId: role.guild.id,
        eventType: EVENT_TYPES.ROLE_CREATE,
        data: {
          title: 'Role Created',
          headline: `${role.toString()} was created`,
          lines,
        },
      });

    } catch (error) {
      logger.error('Error in roleCreate event:', error);
    }
  }
};