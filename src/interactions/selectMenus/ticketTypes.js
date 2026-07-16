import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getUserTicketCount } from '../../services/ticket.js';
import { findTicketType, TICKET_TYPE_SELECT_ID } from '../../utils/ticketTypes.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';

export default {
  name: TICKET_TYPE_SELECT_ID,

  async execute(interaction, client) {
    const allowed = await checkRateLimit(`${interaction.user.id}:create_ticket`, 3, 60_000);
    if (!allowed) {
      await replyUserError(interaction, {
        type: ErrorTypes.RATE_LIMIT,
        message: 'You are creating tickets too quickly. Please wait a minute and try again.',
      });
      return;
    }

    const typeId = interaction.values[0];
    const config = await getGuildConfig(client, interaction.guildId);
    const ticketType = findTicketType(config, typeId);
    if (!ticketType?.enabled) {
      await replyUserError(interaction, {
        type: ErrorTypes.VALIDATION,
        message: 'That ticket type is no longer available. Please refresh the panel.',
      });
      return;
    }

    const maxTicketsPerUser = config.maxTicketsPerUser || 3;
    const currentTicketCount = await getUserTicketCount(interaction.guildId, interaction.user.id);
    if (currentTicketCount >= maxTicketsPerUser) {
      await replyUserError(interaction, {
        type: ErrorTypes.VALIDATION,
        message: `You already have ${currentTicketCount}/${maxTicketsPerUser} open tickets. Close one before creating another.`,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`create_ticket_modal:${ticketType.id}`)
      .setTitle(`Create: ${ticketType.label}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Why are you creating this ticket?')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Describe your issue...')
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );

    await interaction.showModal(modal);
  },
};
