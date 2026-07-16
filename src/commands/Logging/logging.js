import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { LOG_DESTINATIONS, LOG_DESTINATION_LABELS } from '../../utils/logDestinations.js';
import { EVENT_TYPES } from '../../services/loggingService.js';

import dashboard from './modules/logging_dashboard.js';
import channel from './modules/logging_channel.js';

const DESTINATION_CHOICES = LOG_DESTINATIONS.map((destination) => ({
  name: LOG_DESTINATION_LABELS[destination] || destination,
  value: destination,
}));

export default {
  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Manage server logging — channels, filters, and event categories.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Open the logging dashboard — set channels, filters, and toggle categories.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channel')
        .setDescription('Quick-set a log channel without opening the dashboard.')
        .addStringOption((option) =>
          option
            .setName('destination')
            .setDescription('Category destination (message, moderation, role, etc.)')
            .setRequired(false)
            .addChoices(...DESTINATION_CHOICES),
        )
        .addStringOption((option) =>
          option
            .setName('event')
            .setDescription('Optional fine-grained event override (e.g. message.delete)')
            .setRequired(false)
            .setAutocomplete(true),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The text channel for logs.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName('disable')
            .setDescription('Set to True to clear this log channel.')
            .setRequired(false),
        ),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'event') {
      return interaction.respond([]);
    }

    const query = focused.value.toLowerCase();
    const choices = Object.values(EVENT_TYPES)
      .filter((eventType) => eventType.includes(query))
      .slice(0, 25)
      .map((eventType) => ({ name: eventType, value: eventType }));

    return interaction.respond(choices);
  },

  async execute(interaction, config, client) {
    try {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'dashboard') {
        return await dashboard.execute(interaction, config, client);
      }

      if (subcommand === 'channel') {
        return await channel.execute(interaction, config, client);
      }

      await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'This subcommand is not recognised.' });
    } catch (error) {
      logger.error('logging command error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An unexpected error occurred.' }).catch(() => {});
    }
  },
};
