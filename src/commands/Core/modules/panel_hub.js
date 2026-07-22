import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
} from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';

const PANEL_OPTIONS = [
  {
    value: 'welcomer',
    label: 'Welcomer',
    description: 'Welcome, goodbye, quotes, DM, autoroles',
    emoji: '👋',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'lockdown',
    label: 'Lockdown & Anti-Nuke',
    description: 'Quarantine, restrictions, trusted lists',
    emoji: '🛡️',
    permission: PermissionFlagsBits.Administrator,
  },
  {
    value: 'level',
    label: 'Leveling',
    description: 'XP, rewards, clapbacks, announcements',
    emoji: '⚡',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'logging',
    label: 'Logging',
    description: 'Log channels, filters, categories',
    emoji: '📋',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'tickets',
    label: 'Tickets',
    description: 'Panel, types, staff roles',
    emoji: '🎫',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'verification',
    label: 'Verification',
    description: 'Manual verify panel settings',
    emoji: '✅',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'applications',
    label: 'Applications',
    description: 'Staff apps, questions, review',
    emoji: '📝',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'economy',
    label: 'Economy',
    description: 'Currency tools and balances',
    emoji: '💰',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'serverstats',
    label: 'Server Stats',
    description: 'Counter channels and formats',
    emoji: '📊',
    permission: PermissionFlagsBits.ManageGuild,
  },
  {
    value: 'permissions',
    label: 'Role Permissions',
    description: 'Permission templates and apply',
    emoji: '🔑',
    permission: PermissionFlagsBits.Administrator,
  },
  {
    value: 'channelperms',
    label: 'Channel Permissions',
    description: 'Bulk channel overwrites',
    emoji: '#️⃣',
    permission: PermissionFlagsBits.ManageChannels,
  },
  {
    value: 'commands',
    label: 'Commands Access',
    description: 'Enable or disable bot features',
    emoji: '🕹️',
    permission: PermissionFlagsBits.Administrator,
  },
];

function buildHubEmbed(guild) {
  return new EmbedBuilder()
    .setTitle('🎛️ Control Panel')
    .setDescription(
      `Pick a system dashboard for **${guild.name}**.\nEach option opens the same interactive panel used by that feature's slash command.`,
    )
    .setColor(getColor('info'))
    .addFields({
      name: 'Available systems',
      value: PANEL_OPTIONS.map((option) => `${option.emoji} **${option.label}** — ${option.description}`).join('\n'),
    })
    .setFooter({ text: 'Hub closes after 10 minutes of inactivity' })
    .setTimestamp();
}

function buildSelect(guildId) {
  return new StringSelectMenuBuilder()
    .setCustomId(`panel_hub_select_${guildId}`)
    .setPlaceholder('Open a system dashboard...')
    .addOptions(
      PANEL_OPTIONS.map((option) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setDescription(option.description)
          .setValue(option.value)
          .setEmoji(option.emoji),
      ),
    );
}

async function launchDashboard(interaction, client, key) {
  switch (key) {
    case 'welcomer': {
      const { runWelcomerDashboard } = await import('../../Community/modules/welcomer_dashboard.js');
      return runWelcomerDashboard(interaction, client);
    }
    case 'lockdown': {
      const { runLockdownDashboard } = await import('../../Moderation/modules/lockdown_dashboard.js');
      return runLockdownDashboard(interaction, client);
    }
    case 'level': {
      const levelDashboard = (await import('../../Leveling/modules/level_dashboard.js')).default;
      return levelDashboard.execute(interaction, null, client);
    }
    case 'logging': {
      const loggingDashboard = (await import('../../Logging/modules/logging_dashboard.js')).default;
      return loggingDashboard.execute(interaction, null, client);
    }
    case 'tickets': {
      const ticketDashboard = (await import('../../Ticket/modules/ticket_dashboard.js')).default;
      return ticketDashboard.execute(interaction, null, client);
    }
    case 'verification': {
      const verificationDashboard = (await import('../../Verification/modules/verification_dashboard.js')).default;
      return verificationDashboard.execute(interaction, null, client);
    }
    case 'applications': {
      const appDashboard = (await import('../../Community/modules/app_dashboard.js')).default;
      return appDashboard.execute(interaction, null, client);
    }
    case 'economy': {
      const economyDashboard = (await import('../../Economy/modules/economy_dashboard.js')).default;
      return economyDashboard.execute(interaction, null, client);
    }
    case 'serverstats': {
      const { runServerStatsDashboard } = await import('../../ServerStats/modules/serverstats_dashboard.js');
      return runServerStatsDashboard(interaction, client);
    }
    case 'permissions': {
      const { runPermissionsDashboard } = await import('./permissions_dashboard.js');
      return runPermissionsDashboard(interaction, client);
    }
    case 'channelperms': {
      const { runChannelPermsDashboard } = await import('./channelperms_dashboard.js');
      return runChannelPermsDashboard(interaction, client);
    }
    case 'commands': {
      const {
        buildDashboardView,
        handleDashboardComponent,
        createDashboardCollectorFilter,
        isCommandAccessCustomId,
      } = await import('./commands_dashboard.js');

      await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!interaction.deferred && !interaction.replied) return;

      const view = await buildDashboardView(client, interaction.guildId, interaction.guild, 'overview');
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [view.embed],
        components: view.components,
      });

      const replyMessage = await interaction.fetchReply().catch(() => null);
      if (!replyMessage) return;

      const commandsCollector = replyMessage.createMessageComponentCollector({
        filter: createDashboardCollectorFilter(interaction.user.id, interaction.guildId),
        time: 600_000,
      });

      commandsCollector.on('collect', async (componentInteraction) => {
        try {
          if (!isCommandAccessCustomId(componentInteraction.customId)) return;
          await handleDashboardComponent(componentInteraction, client);
        } catch (error) {
          logger.error('Command access dashboard interaction failed from panel', {
            error: error.message,
            customId: componentInteraction.customId,
            guildId: interaction.guildId,
          });
          await replyUserError(componentInteraction, {
            type: ErrorTypes.UNKNOWN,
            message: error.message || 'Failed to update command access.',
          }).catch(() => {});
        }
      });
      return;
    }
    default:
      return replyUserError(interaction, {
        type: ErrorTypes.VALIDATION,
        message: 'Unknown panel option.',
      });
  }
}

export async function runPanelHub(interaction, client) {
  const guildId = interaction.guild.id;

  await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
  if (!interaction.deferred && !interaction.replied) return;

  await InteractionHelper.safeEditReply(interaction, {
    embeds: [buildHubEmbed(interaction.guild)],
    components: [new ActionRowBuilder().addComponents(buildSelect(guildId))],
  });

  const collector = interaction.channel.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i) =>
      i.user.id === interaction.user.id && i.customId === `panel_hub_select_${guildId}`,
    time: 600_000,
  });

  collector.on('collect', async (selectInteraction) => {
    const selected = selectInteraction.values[0];
    const option = PANEL_OPTIONS.find((entry) => entry.value === selected);
    if (!option) return;

    if (!selectInteraction.memberPermissions?.has(option.permission)) {
      await replyUserError(selectInteraction, {
        type: ErrorTypes.PERMISSION,
        message: `You need extra permissions to open **${option.label}**.`,
      }).catch(() => {});
      return;
    }

    collector.stop('navigated');

    try {
      await launchDashboard(selectInteraction, client, selected);
    } catch (error) {
      logger.error('Panel hub failed to open dashboard:', error);
      await replyUserError(selectInteraction, {
        type: ErrorTypes.UNKNOWN,
        message: `Could not open **${option.label}**. Try the feature's own slash command.`,
      }).catch(() => {});
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason !== 'time') return;
    try {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(getColor('warning'))
            .setTitle('Control Panel Closed')
            .setDescription('This hub closed due to inactivity. Run `/panel` again to continue.'),
        ],
        components: [],
      });
    } catch (error) {
      logger.debug('Could not update panel hub on timeout:', error.message);
    }
  });
}
