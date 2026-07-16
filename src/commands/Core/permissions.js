import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { runPermissionsDashboard } from './modules/permissions_dashboard.js';

export default {
  data: new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('Manage reusable channel permission templates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Open the channel permission template dashboard')),
  category: 'Core',

  async execute(interaction, config, client) {
    try {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.reply({
          content: 'You need the **Manage Channels** permission to use this dashboard.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;
      await runPermissionsDashboard(interaction, client);
    } catch (error) {
      await handleInteractionError(interaction, error, { commandName: 'permissions dashboard' });
    }
  },
};
