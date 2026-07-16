import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

export const MAX_TICKET_TYPES = 25;
export const TICKET_TYPE_SELECT_ID = 'create_ticket_type';

function cleanOptional(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeTicketType(input = {}) {
  const staffRoleIds = Array.isArray(input.staffRoleIds)
    ? input.staffRoleIds
    : String(input.staffRoleIds ?? '').split(/[,\s]+/);

  return {
    id: String(input.id ?? '').trim().slice(0, 80),
    label: String(input.label ?? '').trim().slice(0, 100),
    description: String(input.description ?? '').trim().slice(0, 100),
    emoji: cleanOptional(input.emoji),
    categoryId: cleanOptional(input.categoryId),
    logChannelId: cleanOptional(input.logChannelId),
    welcomeText: String(input.welcomeText ?? '').trim().slice(0, 2000),
    enabled: input.enabled !== false && String(input.enabled).toLowerCase() !== 'false',
    staffRoleIds: [...new Set(staffRoleIds.map(cleanOptional).filter(Boolean))].slice(0, 25),
  };
}

export function getTicketTypes(config = {}) {
  if (!Array.isArray(config.ticketTypes)) return [];
  return config.ticketTypes
    .slice(0, MAX_TICKET_TYPES)
    .map(normalizeTicketType)
    .filter((type) => type.id && type.label);
}

export function getEnabledTicketTypes(config = {}) {
  return getTicketTypes(config).filter((type) => type.enabled);
}

export function findTicketType(config, typeId) {
  return getTicketTypes(config).find((type) => type.id === typeId) || null;
}

export function buildTicketPanelComponents(config = {}) {
  const enabledTypes = getEnabledTicketTypes(config);
  if (!enabledTypes.length) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(TICKET_TYPE_SELECT_ID)
    .setPlaceholder('Choose a ticket type...')
    .addOptions(enabledTypes.map((type) => {
      const option = new StringSelectMenuOptionBuilder()
        .setValue(type.id)
        .setLabel(type.label);
      if (type.description) option.setDescription(type.description);
      if (type.emoji) option.setEmoji(type.emoji);
      return option;
    }));

  return [new ActionRowBuilder().addComponents(select)];
}

export function getTicketStaffRoleIds(config = {}, ticketData = null) {
  const snapshotRoles = ticketData?.typeSnapshot?.staffRoleIds;
  const storedRoles = Array.isArray(snapshotRoles) ? snapshotRoles.filter(Boolean).map(String) : [];
  const configuredTypeRoles = getTicketTypes(config).flatMap((type) => type.staffRoleIds);
  const legacyRole = config.ticketStaffRoleId ? [String(config.ticketStaffRoleId)] : [];
  return [...new Set([...storedRoles, ...configuredTypeRoles, ...legacyRole])];
}
