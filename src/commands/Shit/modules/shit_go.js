import { MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { getShitAnnounceSettings, postShitAnnouncement } from '../../../services/shitAnnounceService.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, _config, client) {
        try {
            const settings = await getShitAnnounceSettings(client, interaction.guildId);
            const { channel, message } = await postShitAnnouncement(
                client,
                interaction.guild,
                settings,
                interaction.user,
            );

            return InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed('Posted', `Sent to ${channel}:\n> ${message}`)],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('shit_go error:', error);
            await handleInteractionError(interaction, error, {
                commandName: 'shit',
                source: 'shit_go',
            });
        }
    },
};
