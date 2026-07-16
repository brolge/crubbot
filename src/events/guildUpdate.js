import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';

export default {
  name: Events.GuildUpdate,
  once: false,
  async execute(oldGuild, newGuild) {
    try {
      const changes = [];
      if (oldGuild.name !== newGuild.name) changes.push(`**Name:** ${oldGuild.name} → ${newGuild.name}`);
      if (oldGuild.icon !== newGuild.icon) changes.push('**Icon:** changed');
      if (oldGuild.banner !== newGuild.banner) changes.push('**Banner:** changed');
      if (oldGuild.description !== newGuild.description) {
        changes.push(`**Description:** ${oldGuild.description || '(none)'} → ${newGuild.description || '(none)'}`);
      }
      if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        changes.push(`**Verification:** ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
      }
      if (changes.length) {
        await logEvent({
          client: newGuild.client,
          guildId: newGuild.id,
          eventType: EVENT_TYPES.SERVER_UPDATE,
          data: {
            title: 'Server updated',
            lines: changes,
          },
        });
      }
    } catch (error) {
      logger.error('Error in guildUpdate logging:', error);
    }

    try {
      if (oldGuild.premiumSubscriptionCount !== newGuild.premiumSubscriptionCount) {
        const counters = await getServerCounters(newGuild.client, newGuild.id);
        for (const counter of counters) {
          if (counter.type === 'boosts') {
            await updateCounter(newGuild.client, newGuild, counter);
          }
        }
      }
    } catch (error) {
      logger.error('Error updating boost counters on guildUpdate:', error);
    }
  },
};
