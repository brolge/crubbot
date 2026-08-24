import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { isBotOwner, getOwnerIds } from '../../utils/ownerAccess.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getLockdownConfig } from '../../services/lockdownService.js';
import { getWelcomeConfig } from '../../utils/database.js';
import { getLoggingStatus } from '../../services/loggingService.js';
import { getGuildCounterStats } from '../../services/serverstatsService.js';
import { generateServerBlueprint, applyBlueprintToGuild } from '../../services/serverBlueprintService.js';

function buildBlueprintFile(blueprint) {
  return new AttachmentBuilder(
    Buffer.from(`${JSON.stringify(blueprint, null, 2)}\n`, 'utf8'),
    { name: 'server-blueprint.json' },
  );
}

function chunkLines(lines, maxLength = 1000) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function formatRoleLine(role) {
  const permissions = role.permissions?.length
    ? role.permissions.slice(0, 5).join(', ') + (role.permissions.length > 5 ? '…' : '')
    : 'no special perms';
  const flags = [
    role.hoist ? 'hoisted' : null,
    role.mentionable ? 'mentionable' : null,
    role.color || null,
  ].filter(Boolean).join(' · ');
  return `• **${role.name}**${flags ? ` — ${flags}` : ''}\n  perms: ${permissions}`;
}

function formatChannelLine(channel) {
  const topic = channel.topic ? ` — ${channel.topic}` : '';
  return `• \`${channel.type}\` **#${channel.name}**${topic}`;
}

function buildFormattingField(blueprint) {
  const categoryStyle = blueprint.categories.every((category) => category.name === category.name.toUpperCase())
    ? 'Category names use uppercase section headers'
    : 'Category names use title-style labels';
  const channelStyle = blueprint.categories
    .flatMap((category) => category.channels)
    .every((channel) => channel.name === channel.name.toLowerCase() && channel.name.includes('-'))
    ? 'Channels use lowercase kebab-case names'
    : 'Channels use mixed formatting based on purpose';
  const specialTypes = [...new Set(
    blueprint.categories.flatMap((category) => category.channels.map((channel) => channel.type)),
  )];
  return [
    categoryStyle,
    channelStyle,
    `Channel types included: ${specialTypes.join(', ') || 'text'}`,
    'Announcement channels are intended as read-mostly broadcast spaces when present.',
  ].join('\n');
}

function summarizeBlueprint(blueprint) {
  const categoryCount = blueprint.categories.length;
  const channelCount = blueprint.categories.reduce((sum, category) => sum + category.channels.length, 0);
  const roleChunks = chunkLines(blueprint.roles.map(formatRoleLine));
  const channelChunks = chunkLines(
    blueprint.categories.flatMap((category) => [
      `**${category.name}**`,
      ...category.channels.map(formatChannelLine),
    ]),
  );

  const overview = new EmbedBuilder()
    .setTitle(`🧠 ${blueprint.name}`)
    .setDescription(blueprint.summary)
    .setColor(getColor('primary'))
    .addFields(
      {
        name: 'Structure',
        value: `**${blueprint.roles.length}** roles\n**${categoryCount}** categories\n**${channelCount}** channels`,
        inline: true,
      },
      {
        name: 'Source',
        value: blueprint.source === 'ai' ? 'Gemini' : 'Fallback template',
        inline: true,
      },
      {
        name: 'Formatting Plan',
        value: buildFormattingField(blueprint),
        inline: false,
      },
      {
        name: 'Notes',
        value: blueprint.notes.join('\n') || '`No extra notes`',
        inline: false,
      },
    )
    .setFooter({ text: 'JSON blueprint attached for reuse or manual edits' });

  const embeds = [overview];
  roleChunks.forEach((chunk, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? '🔐 Roles & Permissions' : '🔐 Roles & Permissions (cont.)')
        .setColor(getColor('info'))
        .setDescription(chunk),
    );
  });
  channelChunks.forEach((chunk, index) => {
    embeds.push(
      new EmbedBuilder()
        .setTitle(index === 0 ? '🧱 Channels & Categories' : '🧱 Channels & Categories (cont.)')
        .setColor(getColor('secondary'))
        .setDescription(chunk),
    );
  });
  return embeds;
}

async function resolveTargetGuild(client, interaction, serverId) {
  const chosenId = serverId || interaction.guildId;
  if (!chosenId) return null;
  return interaction.client.guilds.cache.get(chosenId)
    || await interaction.client.guilds.fetch(chosenId).catch(() => null);
}

async function buildOwnerDashboard(guild, client) {
  const [guildConfig, lockdown, welcomeConfig, loggingStatus, stats] = await Promise.all([
    getGuildConfig(client, guild.id),
    getLockdownConfig(client, guild.id),
    getWelcomeConfig(client, guild.id),
    getLoggingStatus(client, guild.id),
    getGuildCounterStats(guild),
  ]);

  const quarantineCount = Object.keys(lockdown.quarantinedMembers || {}).length;
  const bulkCount = lockdown.bulkQuarantine?.memberIds?.length || 0;
  const logRoutes = Object.values(loggingStatus.channels || {}).filter(Boolean).length;

  return new EmbedBuilder()
    .setTitle(`👑 Owner Safety Dashboard — ${guild.name}`)
    .setColor(getColor('info'))
    .setDescription('Read-only bot-owner view of configuration and likely safety triggers.')
    .addFields(
      {
        name: 'Guild',
        value: [
          `**ID:** \`${guild.id}\``,
          `**Owner:** <@${guild.ownerId}>`,
          `**Members:** ${stats.totalCount} total · ${stats.humanCount} humans · ${stats.botCount} bots`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Lockdown',
        value: [
          `**Active:** ${lockdown.active ? 'Yes' : 'No'}`,
          `**Anti-Nuke:** ${lockdown.antiNukeEnabled ? 'On' : 'Off'}`,
          `**Block New Bots:** ${lockdown.guards.blockNewBots ? 'On' : 'Off'}`,
          `**Quarantine Role:** ${lockdown.quarantineRoleId ? `<@&${lockdown.quarantineRoleId}>` : '`Not set`'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Quarantine State',
        value: [
          `**Tracked Members:** ${quarantineCount}`,
          `**Bulk Session:** ${lockdown.bulkQuarantine?.active ? 'Active' : 'Inactive'}`,
          `**Bulk Targets:** ${bulkCount}`,
          `**Trusted Users:** ${lockdown.trustedUserIds.length}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Welcome & Logs',
        value: [
          `**Welcome Enabled:** ${welcomeConfig.enabled ? 'Yes' : 'No'}`,
          `**Goodbye Enabled:** ${welcomeConfig.goodbyeEnabled ? 'Yes' : 'No'}`,
          `**DM Welcome:** ${welcomeConfig.dmEnabled ? 'Yes' : 'No'}`,
          `**Logging Enabled:** ${loggingStatus.enabled ? 'Yes' : 'No'}`,
          `**Configured Log Routes:** ${logRoutes}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Likely Automatic Moderation Causes',
        value: [
          '• **Normal users are not auto-banned by current code**',
          `• **New bot joins** will be kicked if lockdown bot-guard is on: ${lockdown.guards.blockNewBots ? 'currently enabled' : 'currently disabled'}`,
          `• **Quarantine role assignment** can strip roles on members: ${lockdown.quarantineRoleId ? 'configured' : 'not configured'}`,
          `• **Anti-nuke** can quarantine executors after repeated channel/role deletions: ${lockdown.antiNukeEnabled ? 'enabled' : 'disabled'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Feature Health',
        value: [
          `**Welcome Channel:** ${welcomeConfig.channelId ? `<#${welcomeConfig.channelId}>` : '`None`'}`,
          `**Alert Channel:** ${lockdown.alertChannelId ? `<#${lockdown.alertChannelId}>` : '`None`'}`,
          `**Shit Announce:** ${guildConfig.shitAnnounce?.channelId ? `<#${guildConfig.shitAnnounce.channelId}>` : '`None`'}`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: `Allowed owner IDs: ${getOwnerIds().join(', ') || 'none configured'}` })
    .setTimestamp();
}

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Bot owner tools for diagnostics and AI server blueprints')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(true)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Read-only safety and config dashboard for a server')
        .addStringOption((option) =>
          option
            .setName('server_id')
            .setDescription('Optional server ID (useful in DMs)')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('blueprint')
        .setDescription('Generate an AI server blueprint from a prompt')
        .addStringOption((option) =>
          option.setName('prompt').setDescription('What kind of server to build').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('template')
            .setDescription('Starting template style')
            .setRequired(false)
            .addChoices(
              { name: 'PMC', value: 'pmc' },
              { name: 'Milsim', value: 'milsim' },
              { name: 'Community', value: 'community' },
              { name: 'Gaming', value: 'gaming' },
            ),
        )
        .addAttachmentOption((option) =>
          option
            .setName('image')
            .setDescription('Optional reference image for layout/style ideas')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('apply-blueprint')
        .setDescription('Generate and apply a blueprint to the current server')
        .addStringOption((option) =>
          option.setName('prompt').setDescription('What kind of server to build').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('template')
            .setDescription('Starting template style')
            .setRequired(false)
            .addChoices(
              { name: 'PMC', value: 'pmc' },
              { name: 'Milsim', value: 'milsim' },
              { name: 'Community', value: 'community' },
              { name: 'Gaming', value: 'gaming' },
            ),
        )
        .addAttachmentOption((option) =>
          option
            .setName('image')
            .setDescription('Optional reference image for layout/style ideas')
            .setRequired(false),
        ),
    ),
  category: 'Core',

  async execute(interaction, _config, client) {
    try {
      if (!isBotOwner(interaction.user.id)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.PERMISSION,
          message: 'This command is restricted to configured bot owners.',
        });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, {
        flags: MessageFlags.Ephemeral,
      });
      if (!deferred) return;

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'dashboard') {
        const serverId = interaction.options.getString('server_id');
        const guild = await resolveTargetGuild(client, interaction, serverId);
        if (!guild) {
          return await replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: 'Could not resolve that server. Use this inside a server or pass a valid `server_id`.',
          });
        }
        const embed = await buildOwnerDashboard(guild, client);
        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

      const prompt = interaction.options.getString('prompt', true);
      const template = interaction.options.getString('template') || 'community';
      const image = interaction.options.getAttachment('image');
      const blueprint = await generateServerBlueprint({ prompt, template, attachment: image });

      if (subcommand === 'blueprint') {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: summarizeBlueprint(blueprint),
          files: [buildBlueprintFile(blueprint)],
        });
      }

      if (!interaction.guild) {
        return await replyUserError(interaction, {
          type: ErrorTypes.VALIDATION,
          message: 'Apply Blueprint must be run inside the target server.',
        });
      }

      const applied = await applyBlueprintToGuild(
        interaction.guild,
        blueprint,
        `Owner blueprint apply by ${interaction.user.tag}`,
      );

      const embeds = summarizeBlueprint(applied.blueprint);
      embeds[0]
        .setTitle(`🛠️ Applied — ${applied.blueprint.name}`)
        .addFields({
          name: 'Created',
          value: [
            `**Roles:** ${applied.createdRoles.length}`,
            `**Categories:** ${applied.createdCategories.length}`,
            `**Channels:** ${applied.createdChannels.length}`,
          ].join('\n'),
          inline: false,
        });

      return await InteractionHelper.safeEditReply(interaction, {
        embeds,
        files: [buildBlueprintFile(applied.blueprint)],
      });
    } catch (error) {
      await handleInteractionError(interaction, error, { command: 'owner' });
    }
  },
};
