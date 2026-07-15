import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import shitGo from './modules/shit_go.js';

export default {
    data: new SlashCommandBuilder()
        .setName('shit')
        .setDescription('Announce that someone is ripping in the configured channel'),

    category: 'Shit',

    async execute(interaction, config, client) {
        try {
            return await shitGo.execute(interaction, config, client);
        } catch (error) {
            logger.error('Shit command execution failed', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });
            await handleInteractionError(interaction, error, {
                commandName: 'shit',
                source: 'shit_command',
            });
        }
    },
};
