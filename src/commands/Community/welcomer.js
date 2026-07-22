import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, CrubError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import welcomerDashboard from './modules/welcomer_dashboard.js';

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('welcomer')
        .setDescription('Feature-rich welcome, goodbye, quotes, DM, and autorole panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Open the welcomer configuration dashboard'),
        ),

    async execute(interaction, config, client) {
        try {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'You need the **Manage Server** permission to use `/welcomer`.',
                });
            }

            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'dashboard') {
                return await welcomerDashboard.execute(interaction, config, client);
            }

            logger.warn(`Unknown /welcomer subcommand: ${subcommand}`);
        } catch (error) {
            if (error instanceof CrubError) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.CONFIGURATION,
                    message: error.userMessage || 'Something went wrong.',
                });
            }
            await handleInteractionError(interaction, error, { command: 'welcomer' });
        }
    },
};
