import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import shitSetup from './modules/shit_setup.js';

export default {
    data: new SlashCommandBuilder()
        .setName('shitsetup')
        .setDescription('Configure the bathroom announce channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel for announcements. Leave empty to disable.')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Fallback name only (messages normally @ the person who runs /shit)')
                .setRequired(false)
                .setMaxLength(32),
        ),

    category: 'Shit',

    async execute(interaction, config, client) {
        try {
            return await shitSetup.execute(interaction, config, client);
        } catch (error) {
            logger.error('Shitsetup command execution failed', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });
            await handleInteractionError(interaction, error, {
                commandName: 'shitsetup',
                source: 'shitsetup_command',
            });
        }
    },
};
