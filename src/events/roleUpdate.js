import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildRoleUpdate,
  once: false,
  async execute(oldRole, newRole) {
    try {
      const changes = [];
      if (oldRole.name !== newRole.name) changes.push(`**Name:** ${oldRole.name} → ${newRole.name}`);
      if (oldRole.color !== newRole.color) changes.push(`**Color:** ${oldRole.hexColor} → ${newRole.hexColor}`);
      if (oldRole.hoist !== newRole.hoist) changes.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`);
      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`);
      }
      if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        changes.push('**Permissions:** changed');
      }
      if (!changes.length) return;

      await logEvent({
        client: newRole.client,
        guildId: newRole.guild.id,
        eventType: EVENT_TYPES.ROLE_UPDATE,
        data: {
          title: 'Role updated',
          lines: [
            `**Role:** ${newRole} (${newRole.id})`,
            ...changes,
          ],
        },
      });
    } catch (error) {
      logger.error('Error in roleUpdate logging:', error);
    }
  },
};
