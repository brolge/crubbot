import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { handleInteractionError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { runPanelHub } from './modules/panel_hub.js';

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the master control panel for major bot systems')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction, _config, client) {
    try {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'You need the **Manage Server** permission to use `/panel`.',
        });
      }

      return await runPanelHub(interaction, client);
    } catch (error) {
      await handleInteractionError(interaction, error, { command: 'panel' });
    }
  },
};
