import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import {
  engageLockdown,
  getLockdownConfig,
  hardenQuarantineRole,
  liftLockdown,
  quarantineAllMembers,
  restoreAllQuarantinedMembers,
  setExternalAppsBlocked,
  updateLockdownConfig,
} from '../../../services/lockdownService.js';

const DASH = 'ld_dash';

const RESTRICTION_META = [
  { key: 'messaging', label: 'Messaging', description: 'Block sending messages in channels' },
  { key: 'reactions', label: 'Reactions', description: 'Block adding reactions' },
  { key: 'publicThreads', label: 'Public Threads', description: 'Block creating public threads' },
  { key: 'privateThreads', label: 'Private Threads', description: 'Block creating private threads' },
  { key: 'threadMessages', label: 'Thread Messages', description: 'Block messages inside threads' },
];

function formatFailures(result) {
  if (!result.failures?.length) return '';
  const shown = result.failures.slice(0, 10).map((failure) => '- ' + failure).join('\n');
  const omitted = result.failures.length > 10 ? '\n...and ' + (result.failures.length - 10) + ' more.' : '';
  return '\n\n**Partial failures (' + result.failures.length + '):**\n' + shown + omitted;
}

function buildStatusEmbed(config) {
  const restrictions = RESTRICTION_META
    .map((meta) => (config.restrictions[meta.key] ? '🔒' : '🟢') + ' ' + meta.label)
    .join('\n');

  const trustedUsers = config.trustedUserIds.length
    ? config.trustedUserIds.slice(0, 10).map((id) => '<@' + id + '>').join(', ') +
      (config.trustedUserIds.length > 10 ? ' +' + (config.trustedUserIds.length - 10) + ' more' : '')
    : '`None`';
  const trustedRoles = config.trustedRoleIds.length
    ? config.trustedRoleIds.slice(0, 10).map((id) => '<@&' + id + '>').join(', ') +
      (config.trustedRoleIds.length > 10 ? ' +' + (config.trustedRoleIds.length - 10) + ' more' : '')
    : '`None`';

  return new EmbedBuilder()
    .setTitle('🛡️ Lockdown & Anti-Nuke Dashboard')
    .setColor(config.active ? getColor('error') : getColor('success'))
    .addFields(
      {
        name: 'Lockdown',
        value: config.active ? '🔴 **ACTIVE**' : '🟢 Inactive',
        inline: true,
      },
      {
        name: 'Anti-Nuke',
        value: config.antiNukeEnabled ? '✅ Enabled' : '❌ Disabled',
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: true },
      {
        name: 'Triggers',
        value: 'Channels: **4** deletes / 10 min\nRoles: **4** deletes / 1 min (auto-enables anti-nuke + lockdown)',
        inline: false,
      },
      {
        name: 'Quarantine Role',
        value: config.quarantineRoleId ? '<@&' + config.quarantineRoleId + '>' : '`Not set`',
        inline: true,
      },
      {
        name: 'Alert Channel',
        value: config.alertChannelId ? '<#' + config.alertChannelId + '>' : '`Not set`',
        inline: true,
      },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: 'Trusted Users', value: trustedUsers, inline: false },
      { name: 'Trusted Roles', value: trustedRoles, inline: false },
      {
        name: 'Lockdown Restrictions (🔒 = will be blocked when engaged)',
        value: restrictions,
        inline: false,
      },
      {
        name: 'Member Quarantine',
        value: config.bulkQuarantine.active
          ? `🔴 **Active** — ${config.bulkQuarantine.memberIds.length} saved member(s)`
          : `🟢 Inactive — ${Object.keys(config.quarantinedMembers).length} individual record(s)`,
        inline: false,
      },
      {
        name: 'Security Guards',
        value: [
          `${config.guards.blockNewBots ? '🔒' : '🟢'} Block newly joining bots`,
          `${config.guards.lockNewChannels ? '🔒' : '🟢'} Lock newly created channels`,
          `${config.guards.blockExternalApps ? '🔒' : '🟢'} Block user-installed external apps`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Dashboard closes after 10 minutes of inactivity' });
}

function buildHomeComponents(config) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(DASH + '_menu')
    .setPlaceholder('Configure a setting...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Lockdown Restrictions')
        .setDescription('Choose what gets blocked when lockdown engages')
        .setValue('restrictions')
        .setEmoji('🔒'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Quarantine Role')
        .setDescription('Role given to offenders caught by anti-nuke')
        .setValue('quarantine')
        .setEmoji('🚨'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Alert Channel')
        .setDescription('Where anti-nuke alerts are posted')
        .setValue('alert')
        .setEmoji('📢'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Trusted Users')
        .setDescription('Users exempt from anti-nuke triggers')
        .setValue('trusted_users')
        .setEmoji('👤'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Trusted Roles')
        .setDescription('Roles exempt from anti-nuke triggers')
        .setValue('trusted_roles')
        .setEmoji('🎭'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Member Quarantine')
        .setDescription('Quarantine everyone except the owner, bots, and trusted users')
        .setValue('bulk_members')
        .setEmoji('👥'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Join & Channel Guards')
        .setDescription('Control new bots, channels, and external apps')
        .setValue('guards')
        .setEmoji('🧱'),
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DASH + '_engage')
      .setLabel('Engage Lockdown')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(config.active),
    new ButtonBuilder()
      .setCustomId(DASH + '_lift')
      .setLabel('Lift Lockdown')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!config.active),
    new ButtonBuilder()
      .setCustomId(DASH + '_antinuke')
      .setLabel(config.antiNukeEnabled ? 'Disable Anti-Nuke' : 'Enable Anti-Nuke')
      .setStyle(config.antiNukeEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(DASH + '_close')
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary),
  );

  return [new ActionRowBuilder().addComponents(menu), buttons];
}

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DASH + '_back')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildViewComponents(view, config) {
  if (view === 'restrictions') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(DASH + '_restrict')
      .setPlaceholder('Select everything that should be BLOCKED during lockdown')
      .setMinValues(0)
      .setMaxValues(RESTRICTION_META.length)
      .addOptions(
        RESTRICTION_META.map((meta) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(meta.label)
            .setDescription(meta.description)
            .setValue(meta.key)
            .setDefault(Boolean(config.restrictions[meta.key])),
        ),
      );
    return [new ActionRowBuilder().addComponents(select), backRow()];
  }

  if (view === 'quarantine') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId(DASH + '_qrole')
      .setPlaceholder('Select the quarantine role...')
      .setMinValues(1)
      .setMaxValues(1);
    if (config.quarantineRoleId) {
      select.setDefaultRoles(config.quarantineRoleId);
    }
    return [new ActionRowBuilder().addComponents(select), backRow()];
  }

  if (view === 'alert') {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(DASH + '_alert_ch')
      .setPlaceholder('Select the anti-nuke alert channel...')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);
    if (config.alertChannelId) {
      select.setDefaultChannels(config.alertChannelId);
    }
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(DASH + '_alert_clear')
        .setLabel('Clear Alert Channel')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.alertChannelId),
      new ButtonBuilder()
        .setCustomId(DASH + '_back')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
    );
    return [new ActionRowBuilder().addComponents(select), buttons];
  }

  if (view === 'trusted_users') {
    const select = new UserSelectMenuBuilder()
      .setCustomId(DASH + '_tusers')
      .setPlaceholder('Select ALL trusted users (empty = clear list)')
      .setMinValues(0)
      .setMaxValues(25);
    if (config.trustedUserIds.length) {
      select.setDefaultUsers(config.trustedUserIds.slice(0, 25));
    }
    return [new ActionRowBuilder().addComponents(select), backRow()];
  }

  if (view === 'trusted_roles') {
    const select = new RoleSelectMenuBuilder()
      .setCustomId(DASH + '_troles')
      .setPlaceholder('Select ALL trusted roles (empty = clear list)')
      .setMinValues(0)
      .setMaxValues(25);
    if (config.trustedRoleIds.length) {
      select.setDefaultRoles(config.trustedRoleIds.slice(0, 25));
    }
    return [new ActionRowBuilder().addComponents(select), backRow()];
  }

  if (view === 'bulk_members') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(DASH + '_bulk_prepare')
          .setLabel('Quarantine Everyone')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(config.bulkQuarantine.active),
        new ButtonBuilder()
          .setCustomId(DASH + '_bulk_restore')
          .setLabel('Restore Everyone')
          .setStyle(ButtonStyle.Success)
          .setDisabled(config.bulkQuarantine.memberIds.length === 0),
        new ButtonBuilder()
          .setCustomId(DASH + '_back')
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  if (view === 'bulk_confirm') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(DASH + '_bulk_confirm')
          .setLabel('Yes, Quarantine Eligible Members')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(DASH + '_bulk_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  if (view === 'guards') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(DASH + '_guards')
      .setPlaceholder('Select security guards to enable')
      .setMinValues(0)
      .setMaxValues(3)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Block New Bots')
          .setDescription('Kick newly joining bots while lockdown is active')
          .setValue('blockNewBots')
          .setDefault(config.guards.blockNewBots),
        new StringSelectMenuOptionBuilder()
          .setLabel('Lock New Channels')
          .setDescription('Apply lockdown restrictions and snapshot new channels')
          .setValue('lockNewChannels')
          .setDefault(config.guards.lockNewChannels),
        new StringSelectMenuOptionBuilder()
          .setLabel('Block External Apps')
          .setDescription('Stop user-installed apps from posting publicly serverwide')
          .setValue('blockExternalApps')
          .setDefault(config.guards.blockExternalApps),
      );
    return [new ActionRowBuilder().addComponents(select), backRow()];
  }

  return buildHomeComponents(config);
}

function viewEmbed(view, config) {
  const titles = {
    restrictions: ['🔒 Lockdown Restrictions', 'Select everything that should be **blocked** when lockdown engages. Unselected items stay allowed. Saves instantly.'],
    quarantine: ['🚨 Quarantine Role', 'Pick a dedicated empty role. The bot removes all role permissions, denies access in every channel, and keeps future channels denied too. Assigning this role manually also strips the member’s other assignable roles into a restorable snapshot.'],
    alert: ['📢 Alert Channel', 'Pick where anti-nuke quarantine alerts get posted.'],
    trusted_users: ['👤 Trusted Users', 'Select the complete list of users anti-nuke should never quarantine. Submitting replaces the whole list.'],
    trusted_roles: ['🎭 Trusted Roles', 'Select the complete list of roles anti-nuke should never quarantine. Submitting replaces the whole list.'],
    bulk_members: [
      '👥 Emergency Member Quarantine',
      'Removes assignable roles and adds the quarantine role to members. Only the **server owner**, **bots**, and **individually trusted users** are exempt — admins, mods, and trusted roles are NOT spared. Members at or above the bot’s highest role cannot be safely changed and are reported as skipped. Every removed role is snapshotted for **Restore Everyone**.',
    ],
    bulk_confirm: [
      '⚠️ Confirm Server-Wide Member Quarantine',
      'This is a high-impact action. Everyone the bot can manage except the server owner, bots, and individually trusted users — **including admins and mods below the bot** — will lose their assignable roles and receive the quarantine role. The saved snapshots are retained until every member is restored.',
    ],
    guards: [
      '🧱 Join & Channel Guards',
      '**Block New Bots** and **Lock New Channels** act while lockdown is active. **Block External Apps** is persistent: it removes Discord’s Use External Apps permission from editable roles. Discord Administrators bypass permission restrictions, and an existing channel-specific allow may also override it.',
    ],
  };
  const [title, description] = titles[view] || [];
  if (!title) return buildStatusEmbed(config);
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(getColor('info'));
}

export async function runLockdownDashboard(interaction, client) {
  const guildId = interaction.guildId;
  let config = await getLockdownConfig(client, guildId);
  let view = 'home';

  const render = async (comp) => {
    const payload = {
      embeds: [view === 'home' ? buildStatusEmbed(config) : viewEmbed(view, config)],
      components: buildViewComponents(view, config),
    };
    if (comp?.update) {
      await comp.update(payload).catch(async () => {
        await InteractionHelper.safeEditReply(interaction, payload);
      });
    } else {
      await InteractionHelper.safeEditReply(interaction, payload);
    }
  };

  await render();

  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(DASH),
    time: 600_000,
  });

  collector.on('collect', async (comp) => {
    try {
      const id = comp.customId;

      if (id === DASH + '_close') {
        collector.stop('closed');
        await comp.update({
          embeds: [successEmbed('Dashboard Closed', 'Lockdown dashboard closed.')],
          components: [],
        });
        return;
      }

      if (id === DASH + '_back') {
        view = 'home';
        config = await getLockdownConfig(client, guildId);
        await render(comp);
        return;
      }

      if (id === DASH + '_menu' && comp.isStringSelectMenu()) {
        view = comp.values[0];
        await render(comp);
        return;
      }

      if (id === DASH + '_restrict' && comp.isStringSelectMenu()) {
        const selected = new Set(comp.values);
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          restrictions: Object.fromEntries(
            RESTRICTION_META.map((meta) => [meta.key, selected.has(meta.key)]),
          ),
        }));
        view = 'home';
        await render(comp);
        await comp.followUp({
          embeds: [successEmbed('Restrictions Saved', 'Selected restrictions will apply the next time lockdown engages.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === DASH + '_qrole' && comp.isRoleSelectMenu()) {
        const role = comp.roles.first();
        if (!role || role.id === guildId || role.managed || !role.editable) {
          await replyUserError(comp, {
            type: ErrorTypes.VALIDATION,
            message: 'Choose a non-managed role below the bot\u2019s highest role.',
          });
          return;
        }
        await comp.deferUpdate();
        if (config.quarantineRoleId !== role.id) {
          const members = await interaction.guild.members.fetch().catch(() => null);
          if (!members) {
            await comp.followUp({
              embeds: [warningEmbed(
                'Could Not Verify Role Members',
                'I could not verify that this role is empty. Try again before configuring it.',
              )],
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }
          if (role.members.size > 0) {
            await comp.followUp({
              embeds: [warningEmbed(
                'Quarantine Role Must Be Empty',
                `${role} is already assigned to **${role.members.size}** member(s). ` +
                'Choose a dedicated empty role so nobody is accidentally stripped of their roles.',
              )],
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }
        }
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          quarantineRoleId: role.id,
        }));
        const result = await hardenQuarantineRole(
          client,
          interaction.guild,
          role,
          'Quarantine role configured by ' + interaction.user.tag + ' (dashboard)',
        );
        config = await getLockdownConfig(client, guildId);
        view = 'home';
        await render();
        const description = [
          `${role} now has **zero server permissions** and is denied channel access.`,
          `Locked **${result.channelsUpdated}/${result.attemptedChannels}** channels.`,
          `Enforced isolation on **${result.membersEnforced}** existing member(s).`,
          result.membersSkipped
            ? `Skipped **${result.membersSkipped}** owner, bot, unmanageable, or already-recorded member(s).`
            : null,
          result.bounded ? 'The channel operation was capped at 500 channels.' : null,
        ].filter(Boolean).join('\n') + formatFailures(result);
        await comp.followUp({
          embeds: [
            result.success
              ? successEmbed('Quarantine Role Hardened', description)
              : warningEmbed('Quarantine Role Partially Hardened', description),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === DASH + '_alert_ch' && comp.isChannelSelectMenu()) {
        const channel = comp.channels.first();
        const botPerms = channel && interaction.guild.channels.cache.get(channel.id)?.permissionsFor(interaction.guild.members.me);
        if (!botPerms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
          await replyUserError(comp, {
            type: ErrorTypes.PERMISSION,
            message: 'I need View Channel, Send Messages, and Embed Links in that channel.',
          });
          return;
        }
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          alertChannelId: channel.id,
        }));
        view = 'home';
        await render(comp);
        return;
      }

      if (id === DASH + '_alert_clear') {
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          alertChannelId: null,
        }));
        view = 'home';
        await render(comp);
        return;
      }

      if (id === DASH + '_tusers' && comp.isUserSelectMenu()) {
        const ids = [...comp.users.keys()];
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          trustedUserIds: ids,
        }));
        view = 'home';
        await render(comp);
        return;
      }

      if (id === DASH + '_troles' && comp.isRoleSelectMenu()) {
        const ids = [...comp.roles.keys()];
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          trustedRoleIds: ids,
        }));
        view = 'home';
        await render(comp);
        return;
      }

      if (id === DASH + '_guards' && comp.isStringSelectMenu()) {
        await comp.deferUpdate();
        const selected = new Set(comp.values);
        const blockExternalApps = selected.has('blockExternalApps');
        let externalAppsResult = null;
        if (blockExternalApps !== config.guards.blockExternalApps) {
          externalAppsResult = await setExternalAppsBlocked(
            client,
            interaction.guild,
            blockExternalApps,
            'External app guard updated by ' + interaction.user.tag + ' (dashboard)',
          );
        }
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          guards: {
            ...current.guards,
            blockNewBots: selected.has('blockNewBots'),
            lockNewChannels: selected.has('lockNewChannels'),
            blockExternalApps,
          },
        }));
        view = 'home';
        await render();
        const externalAppsLine = externalAppsResult
          ? `\nExternal apps: updated **${externalAppsResult.updated}/${externalAppsResult.attempted}** role(s).` +
            formatFailures(externalAppsResult)
          : '';
        await comp.followUp({
          embeds: [
            externalAppsResult && !externalAppsResult.success
              ? warningEmbed(
                  'Security Guards Partially Saved',
                  'Bot and channel guards apply while lockdown is active. External-app blocking is persistent for non-admin users without overriding channel allows.' +
                  externalAppsLine,
                )
              : successEmbed(
                  'Security Guards Saved',
                  'Bot and channel guards apply while lockdown is active. External-app blocking is persistent for non-admin users without overriding channel allows.' +
                  externalAppsLine,
                ),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === DASH + '_bulk_prepare') {
        if (!config.quarantineRoleId) {
          await replyUserError(comp, {
            type: ErrorTypes.CONFIGURATION,
            message: 'Set an assignable quarantine role before using member quarantine.',
          });
          return;
        }
        view = 'bulk_confirm';
        await render(comp);
        return;
      }

      if (id === DASH + '_bulk_cancel') {
        view = 'bulk_members';
        await render(comp);
        return;
      }

      if (id === DASH + '_bulk_confirm') {
        await comp.deferUpdate();
        const result = await quarantineAllMembers(
          client,
          interaction.guild,
          'Emergency member quarantine by ' + interaction.user.tag,
        );
        config = await getLockdownConfig(client, guildId);
        view = 'bulk_members';
        await render();
        const description = result.alreadyActive
          ? 'A bulk member quarantine is already active. Use **Restore Everyone** first.'
          : `Quarantined **${result.quarantined}/${result.attempted}** eligible members. ` +
            `Skipped **${result.exempt}** exempt or unmanageable member(s) (owner, bots, trusted users, or roles at/above the bot).` +
            formatFailures(result);
        await comp.followUp({
          embeds: [
            result.success
              ? successEmbed('Member Quarantine Complete', description)
              : warningEmbed('Member Quarantine Result', description),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === DASH + '_bulk_restore') {
        await comp.deferUpdate();
        const result = await restoreAllQuarantinedMembers(
          client,
          interaction.guild,
          'Emergency member quarantine lifted by ' + interaction.user.tag,
        );
        config = await getLockdownConfig(client, guildId);
        view = 'bulk_members';
        await render();
        const description = result.notActive
          ? 'No saved quarantined members exist.'
          : `Restored **${result.restored}/${result.attempted}** members.` +
            (result.leftServer ? ` Cleared **${result.leftServer}** member(s) who left.` : '') +
            formatFailures(result);
        await comp.followUp({
          embeds: [
            result.success
              ? successEmbed('Members Restored', description)
              : warningEmbed('Member Restore Result', description),
          ],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === DASH + '_antinuke') {
        config = await getLockdownConfig(client, guildId);
        if (!config.antiNukeEnabled && !config.quarantineRoleId) {
          await replyUserError(comp, {
            type: ErrorTypes.CONFIGURATION,
            message: 'Set a quarantine role first (menu → Quarantine Role).',
          });
          return;
        }
        config = await updateLockdownConfig(client, guildId, (current) => ({
          ...current,
          antiNukeEnabled: !current.antiNukeEnabled,
        }));
        await render(comp);
        return;
      }

      if (id === DASH + '_engage') {
        await comp.deferUpdate();
        config = await getLockdownConfig(client, guildId);
        const result = await engageLockdown(
          client,
          interaction.guild,
          config.restrictions,
          'Lockdown engaged by ' + interaction.user.tag + ' (dashboard)',
        );
        config = await getLockdownConfig(client, guildId);
        await render();
        const description = result.alreadyActive
          ? 'Lockdown is already active. Lift it before taking a new snapshot.'
          : 'Updated **' + result.succeeded + '/' + result.attempted + '** channels.' +
            (result.bounded ? '\nThe operation was capped at 500 channels.' : '') +
            formatFailures(result);
        await comp.followUp({
          embeds: [result.success ? successEmbed('Lockdown Engaged', description) : warningEmbed('Lockdown Result', description)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === DASH + '_lift') {
        await comp.deferUpdate();
        const result = await liftLockdown(
          client,
          interaction.guild,
          'Lockdown lifted by ' + interaction.user.tag + ' (dashboard)',
        );
        config = await getLockdownConfig(client, guildId);
        await render();
        const description = result.notActive
          ? 'No active lockdown snapshot exists.'
          : 'Restored **' + result.succeeded + '/' + result.attempted + '** channels.' +
            formatFailures(result) +
            (result.success ? '' : '\n\nThe snapshot was retained so Lift can be retried.');
        await comp.followUp({
          embeds: [result.success ? successEmbed('Lockdown Lifted', description) : warningEmbed('Lockdown Restore Result', description)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }
    } catch (error) {
      logger.error('Lockdown dashboard error:', error);
      await replyUserError(comp, {
        type: ErrorTypes.UNKNOWN,
        message: 'Something went wrong in the lockdown dashboard.',
      }).catch(() => {});
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time') {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setTitle('Dashboard Timed Out')
            .setDescription('Run /lockdown dashboard again to continue.')
            .setColor(getColor('warning')),
        ],
        components: [],
      }).catch(() => {});
    }
  });
}
