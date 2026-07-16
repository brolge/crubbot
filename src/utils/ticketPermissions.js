// ticketPermissions.js

import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { getTicketData } from './database.js';
import { getTicketStaffRoleIds } from './ticketTypes.js';

export async function getTicketPermissionContext({ client, interaction }) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  const [config, ticketData] = await Promise.all([
    getGuildConfig(client, guildId),
    getTicketData(guildId, channelId)
  ]);

  const hasManageChannels = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
  const staffRoleIds = getTicketStaffRoleIds(config, ticketData);
  const hasTicketStaffRole = staffRoleIds.some(roleId => interaction.member.roles?.cache?.has(roleId));
  const isTicketCreator = Boolean(
    ticketData?.userId && String(ticketData.userId) === String(interaction.user.id),
  );

  return {
    config,
    ticketData,
    hasManageChannels,
    hasTicketStaffRole,
    staffRoleIds,
    isTicketCreator,
    canManageTicket: hasManageChannels || hasTicketStaffRole,
    canCloseTicket: hasManageChannels || hasTicketStaffRole || isTicketCreator,
  };
}