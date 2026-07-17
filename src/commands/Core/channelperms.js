import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { runChannelPermsDashboard } from './modules/channelperms_dashboard.js';

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('channelperms')
    .setDescription('Live channel permission board — toggle role perms and stop threats fast')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Open the live channel permission dashboard')),
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
      await runChannelPermsDashboard(interaction, client);
    } catch (error) {
      await handleInteractionError(interaction, error, { commandName: 'channelperms dashboard' });
    }
  },
};
