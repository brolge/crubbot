import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { errorEmbed, infoEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import {
  engageLockdown,
  getLockdownConfig,
  liftLockdown,
  updateLockdownConfig,
} from '../../services/lockdownService.js';

const actionOption = option => option
  .setName('action')
  .setDescription('Add or remove this trusted subject')
  .setRequired(true)
  .addChoices(
    { name: 'Add', value: 'add' },
    { name: 'Remove', value: 'remove' },
  );

function formatFailures(result) {
  if (!result.failures?.length) return '';
  const shown = result.failures.slice(0, 10).map(failure => `• ${failure}`).join('\n');
  const omitted = result.failures.length > 10 ? `\n…and ${result.failures.length - 10} more.` : '';
  return `\n\n**Partial failures (${result.failures.length}):**\n${shown}${omitted}`;
}

function statusDescription(config) {
  const restrictions = Object.entries(config.restrictions)
    .map(([name, enabled]) => `${enabled ? 'Restricted' : 'Allowed'} — ${name}`)
    .join('\n');
  return [
    `**Lockdown:** ${config.active ? 'ACTIVE' : 'Inactive'}`,
    `**Anti-nuke:** ${config.antiNukeEnabled ? 'Enabled' : 'Disabled'}`,
    `**Quarantine role:** ${config.quarantineRoleId ? `<@&${config.quarantineRoleId}>` : 'Not configured'}`,
    `**Anti-nuke alert channel:** ${config.alertChannelId ? `<#${config.alertChannelId}>` : 'Not configured'}`,
    `**Trusted users:** ${config.trustedUserIds.length}`,
    `**Trusted roles:** ${config.trustedRoleIds.length}`,
    '',
    restrictions,
  ].join('\n');
}

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Configure anti-nuke quarantine and server lockdown')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('Show lockdown and anti-nuke configuration'))
    .addSubcommand(subcommand => subcommand
      .setName('quarantine-role')
      .setDescription('Set the role assigned to quarantined executors')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Assignable quarantine role')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('alert-channel')
      .setDescription('Set the channel for anti-nuke quarantine alerts')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Text channel for anti-nuke alerts. Omit to clear.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)))
    .addSubcommand(subcommand => subcommand
      .setName('trusted-user')
      .setDescription('Add or remove an anti-nuke trusted user')
      .addUserOption(option => option.setName('user').setDescription('Trusted user').setRequired(true))
      .addStringOption(actionOption))
    .addSubcommand(subcommand => subcommand
      .setName('trusted-role')
      .setDescription('Add or remove an anti-nuke trusted role')
      .addRoleOption(option => option.setName('role').setDescription('Trusted role').setRequired(true))
      .addStringOption(actionOption))
    .addSubcommand(subcommand => subcommand
      .setName('anti-nuke')
      .setDescription('Enable or disable channel-deletion anti-nuke')
      .addBooleanOption(option => option
        .setName('enabled')
        .setDescription('Whether anti-nuke should monitor channel deletions')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('engage')
      .setDescription('Apply selected restrictions to @everyone serverwide')
      .addBooleanOption(option => option.setName('messaging').setDescription('Restrict normal messages'))
      .addBooleanOption(option => option.setName('reactions').setDescription('Restrict adding reactions'))
      .addBooleanOption(option => option.setName('public-threads').setDescription('Restrict public thread creation'))
      .addBooleanOption(option => option.setName('private-threads').setDescription('Restrict private thread creation'))
      .addBooleanOption(option => option.setName('thread-messages').setDescription('Restrict messages in threads')))
    .addSubcommand(subcommand => subcommand
      .setName('lift')
      .setDescription('Restore the exact saved @everyone channel overwrites')),

  async execute(interaction, config, client) {
    try {
      if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return InteractionHelper.universalReply(interaction, {
          embeds: [errorEmbed('Administrator Required', 'Only server administrators can use `/lockdown`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'status') {
        const lockdown = await getLockdownConfig(client, interaction.guildId);
        return InteractionHelper.universalReply(interaction, {
          embeds: [infoEmbed('Lockdown Status', statusDescription(lockdown))],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === 'quarantine-role') {
        const role = interaction.options.getRole('role', true);
        if (role.id === interaction.guildId || role.managed || !role.editable) {
          return InteractionHelper.universalReply(interaction, {
            embeds: [errorEmbed('Role Not Assignable', 'Choose a non-managed role below the bot’s highest role.')],
            flags: MessageFlags.Ephemeral,
          });
        }
        await updateLockdownConfig(client, interaction.guildId, current => ({
          ...current,
          quarantineRoleId: role.id,
        }));
        return InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed('Quarantine Role Saved', `${role} will be assigned when anti-nuke triggers.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === 'alert-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          const botPerms = channel.permissionsFor(interaction.guild.members.me);
          if (!botPerms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            return InteractionHelper.universalReply(interaction, {
              embeds: [errorEmbed('Missing Permissions', `I need View Channel, Send Messages, and Embed Links in ${channel}.`)],
              flags: MessageFlags.Ephemeral,
            });
          }
        }
        await updateLockdownConfig(client, interaction.guildId, current => ({
          ...current,
          alertChannelId: channel?.id || null,
        }));
        return InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed(
            channel ? 'Anti-Nuke Alert Channel Saved' : 'Anti-Nuke Alert Channel Cleared',
            channel
              ? `Quarantine alerts will post in ${channel}.`
              : 'Anti-nuke alerts will no longer post to a dedicated channel (bot logs still mirror if logging is enabled).',
          )],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === 'trusted-user' || subcommand === 'trusted-role') {
        const isUser = subcommand === 'trusted-user';
        const subject = isUser
          ? interaction.options.getUser('user', true)
          : interaction.options.getRole('role', true);
        const action = interaction.options.getString('action', true);
        const key = isUser ? 'trustedUserIds' : 'trustedRoleIds';
        await updateLockdownConfig(client, interaction.guildId, current => {
          const ids = new Set(current[key]);
          if (action === 'add') ids.add(subject.id);
          else ids.delete(subject.id);
          return { ...current, [key]: [...ids] };
        });
        return InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed('Trust List Updated', `${subject} was ${action === 'add' ? 'added to' : 'removed from'} the anti-nuke trust list.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (subcommand === 'anti-nuke') {
        const enabled = interaction.options.getBoolean('enabled', true);
        const current = await getLockdownConfig(client, interaction.guildId);
        if (enabled && !current.quarantineRoleId) {
          return InteractionHelper.universalReply(interaction, {
            embeds: [errorEmbed('Quarantine Role Required', 'Configure `/lockdown quarantine-role` before enabling anti-nuke.')],
            flags: MessageFlags.Ephemeral,
          });
        }
        await updateLockdownConfig(client, interaction.guildId, value => ({ ...value, antiNukeEnabled: enabled }));
        return InteractionHelper.universalReply(interaction, {
          embeds: [successEmbed('Anti-Nuke Updated', `Channel-deletion anti-nuke is now **${enabled ? 'enabled' : 'disabled'}**.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (subcommand === 'engage') {
        const current = await getLockdownConfig(client, interaction.guildId);
        const restrictions = {
          messaging: interaction.options.getBoolean('messaging') ?? current.restrictions.messaging,
          reactions: interaction.options.getBoolean('reactions') ?? current.restrictions.reactions,
          publicThreads: interaction.options.getBoolean('public-threads') ?? current.restrictions.publicThreads,
          privateThreads: interaction.options.getBoolean('private-threads') ?? current.restrictions.privateThreads,
          threadMessages: interaction.options.getBoolean('thread-messages') ?? current.restrictions.threadMessages,
        };
        const result = await engageLockdown(client, interaction.guild, restrictions, `Lockdown engaged by ${interaction.user.tag}`);
        const description = result.alreadyActive
          ? 'Lockdown is already active. Lift it before taking a new snapshot.'
          : `Updated **${result.succeeded}/${result.attempted}** channels.${result.bounded ? '\nThe operation was capped at 500 channels.' : ''}${formatFailures(result)}`;
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [result.success ? successEmbed('Lockdown Engaged', description) : warningEmbed('Lockdown Result', description)],
        });
      }

      if (subcommand === 'lift') {
        const result = await liftLockdown(client, interaction.guild, `Lockdown lifted by ${interaction.user.tag}`);
        const description = result.notActive
          ? 'No active lockdown snapshot exists.'
          : `Restored **${result.succeeded}/${result.attempted}** channels.${formatFailures(result)}${result.success ? '' : '\n\nThe snapshot was retained so `/lockdown lift` can be retried.'}`;
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [result.success ? successEmbed('Lockdown Lifted', description) : warningEmbed('Lockdown Restore Result', description)],
        });
      }
    } catch (error) {
      await handleInteractionError(interaction, error, { command: 'lockdown' });
    }
  },
};
