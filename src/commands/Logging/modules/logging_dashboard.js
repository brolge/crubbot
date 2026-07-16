import { EmbedBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { getGuildConfig } from '../../../services/guildConfig.js';
import { getLoggingStatus } from '../../../services/loggingService.js';
import {
  createLoggingDashboardComponents,
  createLoggingCategoryViewComponents,
  createLoggingFilterComponents,
  createLoggingRoutesViewComponents,
  DASHBOARD_CATEGORIES,
  DASHBOARD_CATEGORY_LABELS,
  EVENT_TYPES_BY_CATEGORY,
} from '../../../utils/loggingUi.js';
import {
  LOG_DESTINATIONS,
  LOG_DESTINATION_LABELS,
} from '../../../utils/logDestinations.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export function getCategoryStatus(enabledEvents, category, auditEnabled) {
  if (!auditEnabled) return false;
  const events = enabledEvents || {};
  if (events[`${category}.*`] === false) return false;
  const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
  if (categoryEvents.length === 0) return true;
  return categoryEvents.every((eventType) => events[eventType] !== false);
}

async function formatChannelMention(guild, id) {
  if (!id) return '`Not configured`';
  const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
  return channel ? channel.toString() : `⚠️ Missing (${id})`;
}

function countEnabledCategories(enabledEvents, auditEnabled) {
  const enabled = DASHBOARD_CATEGORIES.filter((key) =>
    getCategoryStatus(enabledEvents, key, auditEnabled),
  ).length;
  return { enabled, total: DASHBOARD_CATEGORIES.length };
}

export async function buildLoggingDashboardView(interaction, client) {
  const guildConfig = await getGuildConfig(client, interaction.guildId);
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);

  const auditEnabled = Boolean(loggingStatus.enabled);
  const channels = loggingStatus.channels || {};

  const routeLines = [];
  for (const destination of LOG_DESTINATIONS) {
    const mention = await formatChannelMention(interaction.guild, channels[destination]);
    routeLines.push(`**${LOG_DESTINATION_LABELS[destination]}:** ${mention}`);
  }

  const lifecycleChannel = await formatChannelMention(interaction.guild, guildConfig.ticketLogsChannelId);
  const transcriptChannel = await formatChannelMention(interaction.guild, guildConfig.ticketTranscriptChannelId);

  const ignore = loggingStatus.ignore || { users: [], channels: [] };
  const { enabled: enabledCount, total } = countEnabledCategories(loggingStatus.enabledEvents, auditEnabled);

  const embed = new EmbedBuilder()
    .setTitle('📝 Logging Dashboard')
    .setDescription(`Manage server logging for **${interaction.guild.name}**. Route each log type to its own channel, matching setups like message-logs / member-logs / moderation-logs.`)
    .setColor(auditEnabled ? getColor('success') : getColor('warning'))
    .addFields(
      {
        name: 'Logging Status',
        value: auditEnabled ? '✅ Enabled' : '❌ Disabled',
        inline: true,
      },
      {
        name: 'Event Categories',
        value: auditEnabled ? `${enabledCount}/${total} enabled` : '`Logging disabled`',
        inline: true,
      },
      {
        name: 'Ignore Filters',
        value: `${ignore.users?.length || 0} users · ${ignore.channels?.length || 0} channels`,
        inline: true,
      },
      {
        name: 'Log Channel Routes',
        value: routeLines.slice(0, 7).join('\n') || '`None configured`',
        inline: false,
      },
      {
        name: 'More Routes',
        value: routeLines.slice(7).join('\n') || '`—`',
        inline: false,
      },
      {
        name: 'Ticket Channels (read-only)',
        value: [
          `**Ticket Logs:** ${lifecycleChannel}`,
          `**Transcripts:** ${transcriptChannel}`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Use Route Log Channels to map each destination · unset routes fall back to Audit' })
    .setTimestamp();

  const components = createLoggingDashboardComponents(loggingStatus.enabledEvents, auditEnabled);
  return { embed, components };
}

export async function buildLoggingCategoriesView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const auditEnabled = Boolean(loggingStatus.enabled);

  const categoryLines = DASHBOARD_CATEGORIES.map((key) => {
    const on = getCategoryStatus(loggingStatus.enabledEvents, key, auditEnabled);
    const label = DASHBOARD_CATEGORY_LABELS[key] || key;
    return `${on ? '✅' : '❌'} ${label}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📋 Event Categories')
    .setDescription(
      auditEnabled
        ? 'Toggle which types of events are logged to your audit channel.'
        : '⚠️ Logging is disabled. Enable it from the main dashboard to send logs.',
    )
    .setColor(getColor('info'))
    .addFields({ name: 'Category Status', value: categoryLines, inline: false })
    .setFooter({ text: 'Green = logging on · Red = logging off' })
    .setTimestamp();

  const components = createLoggingCategoryViewComponents(loggingStatus.enabledEvents, auditEnabled);
  return { embed, components };
}

export async function buildLoggingFilterView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const ignore = loggingStatus.ignore || { users: [], channels: [] };

  const userLines = (ignore.users || []).length
    ? ignore.users.map((id) => `• User \`${id}\``).join('\n')
    : '*No ignored users*';

  const channelLines = (ignore.channels || []).length
    ? ignore.channels.map((id) => `• Channel \`${id}\``).join('\n')
    : '*No ignored channels*';

  const embed = new EmbedBuilder()
    .setTitle('🔇 Log Ignore Filters')
    .setDescription('Users and channels on this list will be skipped when sending audit logs.')
    .setColor(getColor('info'))
    .addFields(
      { name: 'Ignored Users', value: userLines.slice(0, 1024), inline: false },
      { name: 'Ignored Channels', value: channelLines.slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'Use the buttons below to add or remove filters' })
    .setTimestamp();

  const components = createLoggingFilterComponents();
  return { embed, components };
}

export function isCategoriesView(interaction) {
  return interaction.message?.embeds?.[0]?.title === '📋 Event Categories';
}

export function isFilterView(interaction) {
  return interaction.message?.embeds?.[0]?.title === '🔇 Log Ignore Filters';
}

export function isRoutesView(interaction) {
  return interaction.message?.embeds?.[0]?.title === '📡 Log Channel Routes';
}

export async function buildLoggingRoutesView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const channels = loggingStatus.channels || {};

  const lines = [];
  for (const destination of LOG_DESTINATIONS) {
    const mention = await formatChannelMention(interaction.guild, channels[destination]);
    lines.push(`**${LOG_DESTINATION_LABELS[destination]}:** ${mention}`);
  }

  const embed = new EmbedBuilder()
    .setTitle('📡 Log Channel Routes')
    .setDescription('Pick a destination below to set its channel. Unset destinations fall back to **Audit**.')
    .setColor(getColor('info'))
    .addFields(
      { name: 'Current Routes', value: lines.slice(0, 7).join('\n'), inline: false },
      { name: 'More', value: lines.slice(7).join('\n') || '`—`', inline: false },
    )
    .setFooter({ text: 'Example: message → #message-logs · moderation → #moderation-logs' })
    .setTimestamp();

  return { embed, components: createLoggingRoutesViewComponents() };
}

export async function refreshDashboardMessage(interaction, client) {
  let view;
  if (isCategoriesView(interaction)) {
    view = await buildLoggingCategoriesView(interaction, client);
  } else if (isFilterView(interaction)) {
    view = await buildLoggingFilterView(interaction, client);
  } else if (isRoutesView(interaction)) {
    view = await buildLoggingRoutesView(interaction, client);
  } else {
    view = await buildLoggingDashboardView(interaction, client);
  }

  await interaction.message.edit({
    embeds: [view.embed],
    components: view.components,
    content: null,
  }).catch(() => {});
}

export default {
  prefixOnly: false,
  async execute(interaction, config, client) {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need **Manage Server** permissions to view the logging dashboard.' });
      }

      await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      const { embed, components } = await buildLoggingDashboardView(interaction, client);
      await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components });
    } catch (error) {
      logger.error('logging_dashboard error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to load the logging dashboard.' });
    }
  },
};
