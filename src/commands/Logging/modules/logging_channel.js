import { PermissionsBitField, ChannelType } from 'discord.js';
import { setLogChannel, setEventLogChannel, EVENT_TYPES } from '../../../services/loggingService.js';
import { successEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { LOG_DESTINATIONS, LOG_DESTINATION_LABELS } from '../../../utils/logDestinations.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';

const EVENT_CHOICES = Object.values(EVENT_TYPES)
  .slice(0, 25)
  .map((eventType) => ({ name: eventType, value: eventType }));

export default {
  prefixOnly: false,
  async execute(interaction, config, client) {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need **Manage Server** permissions to configure logging channels.' });
      }

      await InteractionHelper.safeDefer(interaction, { ephemeral: true });

      const destination = interaction.options.getString('destination');
      const eventType = interaction.options.getString('event');
      const channel = interaction.options.getChannel('channel');
      const disable = interaction.options.getBoolean('disable') ?? false;

      if (eventType) {
        if (disable || !channel) {
          await setEventLogChannel(client, interaction.guildId, eventType, null);
          return InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('Event Route Cleared', `\`${eventType}\` will use its category channel again.`)],
          });
        }

        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
          return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please provide a valid text channel.' });
        }

        await setEventLogChannel(client, interaction.guildId, eventType, channel.id);
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [successEmbed('Event Route Updated', `\`${eventType}\` logs will go to ${channel}.`)],
        });
      }

      if (!destination) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Provide a destination or a specific event to route.' });
      }

      if (disable || !channel) {
        await setLogChannel(client, interaction.guildId, destination, null);
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [successEmbed(
            'Channel Cleared',
            `The **${LOG_DESTINATION_LABELS[destination] || destination}** channel has been removed.`,
          )],
        });
      }

      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please provide a valid text channel.' });
      }

      const botPerms = channel.permissionsFor(interaction.guild.members.me);
      if (!botPerms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel}.` });
      }

      await setLogChannel(client, interaction.guildId, destination, channel.id);

      return InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed(
          'Channel Updated',
          `**${LOG_DESTINATION_LABELS[destination] || destination}** logs will be sent to ${channel}.\nUse \`/logging dashboard\` to toggle event categories.`,
        )],
      });
    } catch (error) {
      logger.error('logging_channel error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to update the log channel.' });
    }
  },
};

export { LOG_DESTINATIONS, EVENT_CHOICES };
