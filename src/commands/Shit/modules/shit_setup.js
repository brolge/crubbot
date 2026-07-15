import { PermissionsBitField, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, infoEmbed } from '../../../utils/embeds.js';
import { saveShitAnnounceSettings, DEFAULT_SHIT_DISPLAY_NAME } from '../../../services/shitAnnounceService.js';

export default {
    async execute(interaction, _config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [infoEmbed('Permission Denied', 'You need **Manage Server** to configure bathroom announcements.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const channel = interaction.options.getChannel('channel');
        const name = interaction.options.getString('name');

        if (!channel) {
            await saveShitAnnounceSettings(client, interaction.guildId, {
                channelId: null,
            });

            return InteractionHelper.safeReply(interaction, {
                embeds: [infoEmbed('Announcements Disabled', 'Bathroom announcements are turned off for this server.')],
                flags: MessageFlags.Ephemeral,
            });
        }

        const displayName = (name?.trim() || DEFAULT_SHIT_DISPLAY_NAME).slice(0, 32);

        await saveShitAnnounceSettings(client, interaction.guildId, {
            channelId: channel.id,
            displayName,
        });

        return InteractionHelper.safeReply(interaction, {
            embeds: [successEmbed(
                'Bathroom Announcements Ready',
                `**${displayName}** announcements will post in ${channel}.\n\nRun \`/shit\` whenever it's go time.`,
            )],
            flags: MessageFlags.Ephemeral,
        });
    },
};
