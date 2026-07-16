import { ChannelType, EmbedBuilder } from 'discord.js';
import { getGuildConfig } from './guildConfig.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { logger } from '../utils/logger.js';

function buildAntiNukeEmbed(guild, { executor, reason, quarantine, lockdownResult, deletedChannelId }) {
  const quarantineLine = quarantine?.error
    ? `Failed — ${quarantine.error}`
    : `Assigned quarantine role · removed ${quarantine?.removedRoleIds?.length || 0} role(s)`;
  const lockdownLine = lockdownResult?.alreadyActive
    ? 'Already active'
    : `${lockdownResult?.succeeded || 0}/${lockdownResult?.attempted || 0} channels updated`;

  return new EmbedBuilder()
    .setColor(0x8B0000)
    .setTitle('☢️ Anti-Nuke Quarantine')
    .setDescription([
      `**Executor:** ${executor ? `${executor} (\`${executor.id}\`)` : 'Unknown'}`,
      `**Reason:** ${reason}`,
      deletedChannelId ? `**Last deleted channel ID:** \`${deletedChannelId}\`` : null,
      `**Quarantine:** ${quarantineLine}`,
      `**Lockdown:** ${lockdownLine}`,
    ].filter(Boolean).join('\n'))
    .setThumbnail(executor?.displayAvatarURL?.({ size: 256 }) || null)
    .setFooter({ text: guild.name, iconURL: guild.iconURL({ size: 64 }) || undefined })
    .setTimestamp();
}

export async function sendAntiNukeAlert(client, guild, lockdown, payload) {
  const embed = buildAntiNukeEmbed(guild, payload);
  const executor = payload.executor;
  const alertChannelId = lockdown?.alertChannelId || null;

  let alertPosted = false;
  if (alertChannelId) {
    try {
      const channel = guild.channels.cache.get(alertChannelId)
        || await guild.channels.fetch(alertChannelId).catch(() => null);
      if (channel?.type === ChannelType.GuildText) {
        const perms = channel.permissionsFor(guild.members.me);
        if (perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
          await channel.send({
            content: lockdown.quarantineRoleId ? `Quarantine applied <@&${lockdown.quarantineRoleId}>` : undefined,
            embeds: [embed],
            allowedMentions: {
              roles: lockdown.quarantineRoleId ? [lockdown.quarantineRoleId] : [],
              parse: [],
            },
          });
          alertPosted = true;
        }
      }
    } catch (error) {
      logger.error('Anti-nuke alert channel send failed', {
        guildId: guild.id,
        channelId: alertChannelId,
        error: error.message,
      });
    }
  }

  try {
    const config = await getGuildConfig(client, guild.id);
    if (config?.logging?.enabled) {
      await logEvent({
        client,
        guildId: guild.id,
        eventType: EVENT_TYPES.SECURITY_ANTINUKE,
        data: {
          title: 'Anti-Nuke Quarantine',
          color: 0x8B0000,
          lines: [
            `**Executor:** ${executor ? `${executor} (\`${executor.id}\`)` : 'Unknown'}`,
            `**Reason:** ${payload.reason}`,
            payload.deletedChannelId ? `**Last deleted channel ID:** \`${payload.deletedChannelId}\`` : null,
            `**Alert channel:** ${alertPosted ? 'posted' : (alertChannelId ? 'failed/missing perms' : 'not configured')}`,
          ].filter(Boolean),
          thumbnail: executor?.displayAvatarURL?.({ size: 256 }) || undefined,
          userId: executor?.id,
        },
      });
    }
  } catch (error) {
    logger.error('Anti-nuke logging mirror failed', { guildId: guild.id, error: error.message });
  }

  return { alertPosted, alertChannelId };
}
