import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import {
  enforceExternalAppRolePolicy,
  getLockdownConfig,
} from '../services/lockdownService.js';

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
        await enforceExternalAppRolePolicy(newRole.client, newRole).catch((error) => {
          logger.error('External app role policy enforcement failed:', {
            guildId: newRole.guild.id,
            roleId: newRole.id,
            error: error.message,
          });
        });
        const lockdown = await getLockdownConfig(newRole.client, newRole.guild.id);
        if (
          lockdown.quarantineRoleId === newRole.id
          && newRole.permissions.bitfield !== 0n
          && newRole.editable
        ) {
          await newRole.setPermissions([], 'Keep quarantine role permissions disabled');
          changes.push('**Quarantine enforcement:** permissions reset to none');
        }
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
