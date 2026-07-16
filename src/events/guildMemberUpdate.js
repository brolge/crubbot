import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild) return;

      if (oldMember.nickname !== newMember.nickname) {
        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
          data: {
            title: 'Nickname changed',
            lines: [
              `**User:** ${newMember.user.toString()} (${newMember.user.tag})`,
              `**ID:** ${newMember.user.id}`,
              `**Before:** ${oldMember.nickname || '(no nickname)'}`,
              `**After:** ${newMember.nickname || '(no nickname)'}`,
            ],
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
            userId: newMember.user.id,
          },
        });
      }

      const oldRoles = new Set(oldMember.roles.cache.keys());
      const newRoles = new Set(newMember.roles.cache.keys());
      const added = [...newRoles].filter((roleId) => !oldRoles.has(roleId) && roleId !== newMember.guild.id);
      const removed = [...oldRoles].filter((roleId) => !newRoles.has(roleId) && roleId !== newMember.guild.id);

      for (const roleId of added) {
        const role = newMember.guild.roles.cache.get(roleId);
        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.ROLE_GIVE,
          data: {
            title: 'Role given',
            lines: [
              `**User:** ${newMember.user.toString()} (${newMember.user.id})`,
              `**Role:** ${role || roleId}`,
            ],
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
            userId: newMember.user.id,
          },
        });
      }

      for (const roleId of removed) {
        const role = newMember.guild.roles.cache.get(roleId) || oldMember.roles.cache.get(roleId);
        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.ROLE_REMOVE,
          data: {
            title: 'Role removed',
            lines: [
              `**User:** ${newMember.user.toString()} (${newMember.user.id})`,
              `**Role:** ${role || roleId}`,
            ],
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
            userId: newMember.user.id,
          },
        });
      }
    } catch (error) {
      logger.error('Error in guildMemberUpdate event:', error);
    }
  },
};
