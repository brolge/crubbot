import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { CrubError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import {
  createGiveawayButtons,
  createGiveawayEmbed,
  selectWinnersWithDisclosedChoice,
} from '../../services/giveawayService.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('gselect')
    .setDescription('Transparently select an entered user as a giveaway winner')
    .addStringOption((option) =>
      option
        .setName('messageid')
        .setDescription('Message ID of the ended giveaway')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('winner')
        .setDescription('Entered user to select as a disclosed manual winner')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        throw new CrubError(
          'Manual giveaway selection used outside a guild',
          ErrorTypes.VALIDATION,
          'This command can only be used in a server.',
        );
      }
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new CrubError(
          'User lacks ManageGuild permission',
          ErrorTypes.PERMISSION,
          'You need **Manage Server** to select a giveaway winner.',
        );
      }

      const messageId = interaction.options.getString('messageid', true);
      const selectedUser = interaction.options.getUser('winner', true);
      if (!/^\d+$/.test(messageId)) {
        throw new CrubError(
          'Invalid giveaway message ID',
          ErrorTypes.VALIDATION,
          'Provide a valid giveaway message ID.',
        );
      }

      const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
      const giveaway = giveaways.find((entry) => entry.messageId === messageId);
      if (!giveaway) {
        throw new CrubError(
          `Giveaway not found: ${messageId}`,
          ErrorTypes.VALIDATION,
          'No giveaway with that message ID was found.',
        );
      }
      if (!giveaway.isEnded && !giveaway.ended) {
        throw new CrubError(
          `Giveaway is still active: ${messageId}`,
          ErrorTypes.VALIDATION,
          'End the giveaway with `/gend` before selecting a winner.',
        );
      }

      const participants = [...new Set(giveaway.participants || [])];
      const winnerCount = Number.isInteger(giveaway.winnerCount)
        ? giveaway.winnerCount
        : 1;
      const winnerIds = selectWinnersWithDisclosedChoice(
        participants,
        winnerCount,
        selectedUser.id,
      );
      const randomWinners = winnerIds.filter((id) => id !== selectedUser.id);
      const updatedGiveaway = {
        ...giveaway,
        winnerCount,
        winnerIds,
        manuallySelectedWinnerId: selectedUser.id,
        manuallySelectedAt: new Date().toISOString(),
        manuallySelectedBy: interaction.user.id,
      };

      const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        throw new CrubError(
          'Giveaway channel is unavailable',
          ErrorTypes.CONFIGURATION,
          'The giveaway channel could not be found.',
        );
      }
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        throw new CrubError(
          'Giveaway message is unavailable',
          ErrorTypes.CONFIGURATION,
          'The original giveaway message could not be found.',
        );
      }

      await message.edit({
        content: '📋 **GIVEAWAY RESULT — INCLUDES A DISCLOSED ADMIN-SELECTED WINNER**',
        embeds: [createGiveawayEmbed(updatedGiveaway, 'reroll', winnerIds)],
        components: [createGiveawayButtons(true)],
      });

      const winnerMentions = winnerIds.map((id) => `<@${id}>`).join(', ');
      const announcement = [
        `📋 **DISCLOSED MANUAL GIVEAWAY SELECTION** for **${giveaway.prize}**`,
        `Admin-selected winner: <@${selectedUser.id}>`,
        winnerCount > 1
          ? `Other randomly selected winner(s): ${randomWinners.map((id) => `<@${id}>`).join(', ')}`
          : null,
        `Selection performed by <@${interaction.user.id}>.`,
      ].filter(Boolean).join('\n');

      const existingPing = giveaway.winnerPingMessageId
        ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
        : null;
      if (existingPing) {
        await existingPing.edit({ content: announcement });
      } else {
        const pingMessage = await channel.send({ content: announcement });
        updatedGiveaway.winnerPingMessageId = pingMessage.id;
      }
      await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);

      logger.warn('Giveaway winner manually selected with public disclosure', {
        guildId: interaction.guildId,
        messageId,
        selectedWinnerId: selectedUser.id,
        selectedBy: interaction.user.id,
        allWinnerIds: winnerIds,
      });

      await InteractionHelper.safeReply(interaction, {
        embeds: [successEmbed(
          'Winner Selection Published',
          `Published ${winnerMentions}. The manually selected winner and selecting admin are clearly disclosed in the giveaway channel.`,
        )],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('Error in gselect command:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'gselect',
      });
    }
  },
};
