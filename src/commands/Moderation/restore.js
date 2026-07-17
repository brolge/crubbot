import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getLockdownConfig, unquarantineMember } from '../../services/lockdownService.js';

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Unquarantine a user and restore the roles anti-nuke removed')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The quarantined user to restore')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optional reason for the restore')
        .setRequired(false)
        .setMaxLength(200),
    ),
  category: 'Moderation',

  async execute(interaction, config, client) {
    try {
      if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Administrator Required', 'Only server administrators can use `/restore`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const target = interaction.options.getUser('user', true);
      const reason =
        interaction.options.getString('reason')?.trim()
        || `Quarantine lifted by ${interaction.user.tag}`;

      const lockdown = await getLockdownConfig(client, interaction.guildId);
      if (!lockdown.quarantinedMembers?.[target.id]) {
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed(
            'Not Quarantined',
            `${target} is not on the anti-nuke quarantine list.\n` +
            'If they still have the quarantine role, remove it manually — there is no saved role snapshot for them.',
          )],
        });
      }

      const result = await unquarantineMember(client, interaction.guild, target.id, reason);

      if (result.leftServer) {
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [warningEmbed(
            'Cleared Quarantine Record',
            `${target} is no longer in the server, so roles could not be restored.\n` +
            `Their quarantine record was cleared (**${result.missingRoleIds.length}** saved role(s) discarded).`,
          )],
        });
      }

      const restored = result.restoredRoleIds.map((id) => `<@&${id}>`).join(', ') || '`None`';
      const missing = result.missingRoleIds.length
        ? `\n**Missing roles (deleted since quarantine):** ${result.missingRoleIds.map((id) => `\`${id}\``).join(', ')}`
        : '';
      const failures = result.failures.length
        ? `\n\n**Partial failures:**\n${result.failures.slice(0, 10).map((line) => `• ${line}`).join('\n')}`
        : '';

      const description =
        `Restored **${result.restoredRoleIds.length}** role(s) to ${target} and removed the quarantine role.\n` +
        `**Roles restored:** ${restored}` +
        missing +
        failures +
        (result.record?.reason ? `\n\n**Original quarantine reason:** ${result.record.reason}` : '');

      return InteractionHelper.safeEditReply(interaction, {
        embeds: [
          result.success
            ? successEmbed('User Restored', description)
            : warningEmbed('User Partially Restored', description),
        ],
      });
    } catch (error) {
      logger.error('Restore command error:', error);
      await handleInteractionError(interaction, error, { command: 'restore' });
    }
  },
};
