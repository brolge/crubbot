import {
  AuditLogEvent,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';
import { logger } from '../utils/logger.js';
import { sendAntiNukeAlert } from './antiNukeAlert.js';
import {
  DEFAULT_RESTRICTIONS,
  ANTI_NUKE_WINDOW_MS,
  ANTI_NUKE_THRESHOLD,
  ANTI_NUKE_ROLE_WINDOW_MS,
  ANTI_NUKE_ROLE_THRESHOLD,
  buildRestrictionMask,
  isTrustedExecutor,
  normalizeLockdownConfig,
  recordDeletion,
  restrictOverwriteState,
  selectUnambiguousAuditEntry,
} from './lockdownPolicy.js';

export const MAX_LOCKDOWN_CHANNELS = 500;
export const MAX_QUARANTINE_ROLES = 250;

export const QUARANTINE_CHANNEL_DENIES = Object.freeze({
  ViewChannel: false,
  CreateInstantInvite: false,
  AddReactions: false,
  SendMessages: false,
  SendTTSMessages: false,
  ManageMessages: false,
  EmbedLinks: false,
  AttachFiles: false,
  ReadMessageHistory: false,
  MentionEveryone: false,
  UseExternalEmojis: false,
  Connect: false,
  Speak: false,
  Stream: false,
  UseVAD: false,
  PrioritySpeaker: false,
  MuteMembers: false,
  DeafenMembers: false,
  MoveMembers: false,
  UseApplicationCommands: false,
  RequestToSpeak: false,
  ManageThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  UseExternalStickers: false,
  SendMessagesInThreads: false,
  UseEmbeddedActivities: false,
  UseSoundboard: false,
  UseExternalSounds: false,
  SendVoiceMessages: false,
  CreateEvents: false,
  ManageEvents: false,
  SendPolls: false,
});

const channelDeletionWindows = new Map();
const roleDeletionWindows = new Map();
const guildOperations = new Map();

function operationForGuild(guildId, operation) {
  const previous = guildOperations.get(guildId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  guildOperations.set(guildId, current);
  return current.finally(() => {
    if (guildOperations.get(guildId) === current) guildOperations.delete(guildId);
  });
}

async function saveLockdownConfig(client, guildId, lockdown) {
  const config = await getGuildConfig(client, guildId);
  const saved = await setGuildConfig(client, guildId, { ...config, lockdown });
  if (saved !== true) {
    throw new Error('Lockdown configuration could not be persisted');
  }
}

export async function getLockdownConfig(client, guildId) {
  const config = await getGuildConfig(client, guildId);
  return normalizeLockdownConfig(config.lockdown);
}

export async function updateLockdownConfig(client, guildId, updater) {
  return operationForGuild(guildId, async () => {
    const current = await getLockdownConfig(client, guildId);
    const updated = normalizeLockdownConfig(await updater(current));
    await saveLockdownConfig(client, guildId, updated);
    return updated;
  });
}

function canEditSecurityRole(guild, role) {
  if (!role || role.managed) return false;
  if (role.id === guild.id) {
    return guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) === true;
  }
  return role.editable;
}

export async function setExternalAppsBlocked(
  client,
  guild,
  blocked,
  reason = 'Update external app security policy',
) {
  await guild.roles.fetch().catch(() => null);
  const current = await getLockdownConfig(client, guild.id);
  const permission = PermissionFlagsBits.UseExternalApps;
  const failures = [];
  let updated = 0;

  if (blocked) {
    const rolesWithPermission = [...guild.roles.cache.values()]
      .filter((role) => role.permissions.has(permission, false));
    const roleIds = [...new Set([
      ...current.guards.externalAppRoleIds,
      ...rolesWithPermission.map((role) => role.id),
    ])].slice(0, 250);

    await updateLockdownConfig(client, guild.id, (config) => ({
      ...config,
      guards: {
        ...config.guards,
        blockExternalApps: true,
        externalAppRoleIds: roleIds,
      },
    }));

    for (const role of rolesWithPermission) {
      if (!canEditSecurityRole(guild, role)) {
        failures.push(`${role.name}: role is above the bot or managed`);
        continue;
      }
      try {
        await role.setPermissions(role.permissions.bitfield & ~permission, reason);
        updated += 1;
      } catch (error) {
        failures.push(`${role.name}: ${error.message}`);
      }
    }

    return {
      success: failures.length === 0,
      blocked: true,
      attempted: rolesWithPermission.length,
      updated,
      failures,
    };
  }

  const roleIds = [...current.guards.externalAppRoleIds];
  await updateLockdownConfig(client, guild.id, (config) => ({
    ...config,
    guards: {
      ...config.guards,
      blockExternalApps: false,
    },
  }));

  const unresolved = [];
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    if (!canEditSecurityRole(guild, role)) {
      failures.push(`${role.name}: role is above the bot or managed`);
      unresolved.push(roleId);
      continue;
    }
    try {
      await role.setPermissions(role.permissions.bitfield | permission, reason);
      updated += 1;
    } catch (error) {
      failures.push(`${role.name}: ${error.message}`);
      unresolved.push(roleId);
    }
  }

  await updateLockdownConfig(client, guild.id, (config) => ({
    ...config,
    guards: {
      ...config.guards,
      blockExternalApps: false,
      externalAppRoleIds: unresolved,
    },
  }));

  return {
    success: failures.length === 0,
    blocked: false,
    attempted: roleIds.length,
    updated,
    failures,
  };
}

export async function enforceExternalAppRolePolicy(client, role) {
  if (!role?.guild) return { ignored: 'not_guild_role' };
  const lockdown = await getLockdownConfig(client, role.guild.id);
  if (
    !lockdown.guards.blockExternalApps
    || !role.permissions.has(PermissionFlagsBits.UseExternalApps, false)
  ) {
    return { ignored: 'not_required' };
  }
  if (!canEditSecurityRole(role.guild, role)) {
    return { ignored: 'not_editable' };
  }

  await updateLockdownConfig(client, role.guild.id, (config) => ({
    ...config,
    guards: {
      ...config.guards,
      externalAppRoleIds: [...new Set([
        ...config.guards.externalAppRoleIds,
        role.id,
      ])].slice(0, 250),
    },
  }));
  await role.setPermissions(
    role.permissions.bitfield & ~PermissionFlagsBits.UseExternalApps,
    'External app posting is blocked in this server',
  );
  return { enforced: true, roleId: role.id };
}

function manageableChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter(channel => channel?.permissionOverwrites?.cache && typeof channel.permissionOverwrites.set === 'function')
    .slice(0, MAX_LOCKDOWN_CHANNELS);
}

function snapshotEveryoneOverwrite(channel, everyoneId) {
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
  return {
    channelId: channel.id,
    existed: Boolean(overwrite),
    allow: (overwrite?.allow?.bitfield ?? 0n).toString(),
    deny: (overwrite?.deny?.bitfield ?? 0n).toString(),
  };
}

async function replaceEveryoneOverwrite(channel, everyoneId, state, reason) {
  const others = [...channel.permissionOverwrites.cache.values()]
    .filter(overwrite => overwrite.id !== everyoneId)
    .map(overwrite => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
    }));

  if (state?.existed !== false) {
    others.push({
      id: everyoneId,
      type: OverwriteType.Role,
      allow: BigInt(state?.allow ?? 0),
      deny: BigInt(state?.deny ?? 0),
    });
  }
  await channel.permissionOverwrites.set(others, reason);
}

export async function engageLockdown(client, guild, restrictions, reason = 'Manual server lockdown') {
  return operationForGuild(guild.id, async () => {
    const lockdown = await getLockdownConfig(client, guild.id);
    if (lockdown.active) {
      return { success: false, alreadyActive: true, attempted: 0, succeeded: 0, failures: [] };
    }

    const selected = { ...DEFAULT_RESTRICTIONS, ...restrictions };
    const mask = buildRestrictionMask(selected);
    if (mask === 0n) {
      return { success: false, attempted: 0, succeeded: 0, failures: ['No restrictions were selected.'] };
    }

    const channels = manageableChannels(guild);
    const snapshot = {
      createdAt: new Date().toISOString(),
      restrictions: selected,
      channels: channels.map(channel => snapshotEveryoneOverwrite(channel, guild.roles.everyone.id)),
    };

    lockdown.active = true;
    lockdown.restrictions = selected;
    lockdown.snapshot = snapshot;
    await saveLockdownConfig(client, guild.id, lockdown);

    const failures = [];
    let succeeded = 0;
    for (const channel of channels) {
      const original = snapshot.channels.find(item => item.channelId === channel.id);
      try {
        await replaceEveryoneOverwrite(
          channel,
          guild.roles.everyone.id,
          restrictOverwriteState(original, selected),
          reason,
        );
        succeeded += 1;
      } catch (error) {
        failures.push(`${channel.id}: ${error.message}`);
        logger.error('Lockdown channel update failed', { guildId: guild.id, channelId: channel.id, error: error.message });
      }
    }

    return {
      success: failures.length === 0,
      attempted: channels.length,
      succeeded,
      failures,
      bounded: guild.channels.cache.size > MAX_LOCKDOWN_CHANNELS,
    };
  });
}

export async function liftLockdown(client, guild, reason = 'Server lockdown lifted') {
  return operationForGuild(guild.id, async () => {
    const lockdown = await getLockdownConfig(client, guild.id);
    if (!lockdown.active || !lockdown.snapshot) {
      return { success: false, notActive: true, attempted: 0, succeeded: 0, failures: [] };
    }

    const states = lockdown.snapshot.channels.slice(0, MAX_LOCKDOWN_CHANNELS);
    const failures = [];
    let succeeded = 0;
    for (const state of states) {
      const channel = guild.channels.cache.get(state.channelId);
      if (!channel) {
        failures.push(`${state.channelId}: channel no longer exists`);
        continue;
      }
      try {
        await replaceEveryoneOverwrite(channel, guild.roles.everyone.id, state, reason);
        succeeded += 1;
      } catch (error) {
        failures.push(`${state.channelId}: ${error.message}`);
        logger.error('Lockdown channel restore failed', { guildId: guild.id, channelId: state.channelId, error: error.message });
      }
    }

    if (failures.length === 0) {
      lockdown.active = false;
      lockdown.snapshot = null;
      await saveLockdownConfig(client, guild.id, lockdown);
    }

    return { success: failures.length === 0, attempted: states.length, succeeded, failures };
  });
}

export async function applyQuarantineRoleToChannel(
  channel,
  quarantineRole,
  reason = 'Enforce quarantine isolation',
) {
  if (
    !channel?.permissionOverwrites?.cache
    || typeof channel.permissionOverwrites.edit !== 'function'
    || !quarantineRole
  ) {
    return false;
  }
  await channel.permissionOverwrites.edit(
    quarantineRole,
    QUARANTINE_CHANNEL_DENIES,
    { reason },
  );
  return true;
}

export async function hardenQuarantineRole(
  client,
  guild,
  quarantineRole,
  reason = 'Harden quarantine role',
) {
  if (!quarantineRole?.editable || quarantineRole.managed || quarantineRole.id === guild.id) {
    throw new Error('Configured quarantine role is missing or not assignable');
  }

  const failures = [];
  let channelsUpdated = 0;
  try {
    await quarantineRole.setPermissions([], reason);
  } catch (error) {
    failures.push(`role permissions: ${error.message}`);
  }

  const channels = manageableChannels(guild);
  for (const channel of channels) {
    try {
      await applyQuarantineRoleToChannel(channel, quarantineRole, reason);
      channelsUpdated += 1;
    } catch (error) {
      failures.push(`${channel.id}: ${error.message}`);
    }
  }

  await guild.members.fetch().catch(() => null);
  let membersEnforced = 0;
  let membersSkipped = 0;
  let lockdown = await getLockdownConfig(client, guild.id);
  for (const member of quarantineRole.members.values()) {
    if (
      member.id === guild.ownerId
      || member.user.bot
      || !member.manageable
      || lockdown.quarantinedMembers[member.id]
    ) {
      membersSkipped += 1;
      continue;
    }
    try {
      await quarantineMember(client, guild, member, lockdown, reason);
      membersEnforced += 1;
      lockdown = await getLockdownConfig(client, guild.id);
    } catch (error) {
      failures.push(`${member.user.tag} (${member.id}): ${error.message}`);
    }
  }

  return {
    success: failures.length === 0,
    attemptedChannels: channels.length,
    channelsUpdated,
    membersEnforced,
    membersSkipped,
    failures,
    bounded: guild.channels.cache.size > MAX_LOCKDOWN_CHANNELS,
  };
}

export async function enforceConfiguredQuarantineOnChannel(client, channel) {
  if (!channel?.guild) return { ignored: 'not_guild_channel' };
  const lockdown = await getLockdownConfig(client, channel.guild.id);
  const role = lockdown.quarantineRoleId
    ? channel.guild.roles.cache.get(lockdown.quarantineRoleId)
    : null;
  if (!role) return { ignored: 'not_configured' };
  await applyQuarantineRoleToChannel(
    channel,
    role,
    'Apply quarantine isolation to new channel',
  );
  return { applied: true, roleId: role.id, channelId: channel.id };
}

export async function quarantineMember(client, guild, member, lockdown, reason) {
  const quarantineRole = lockdown.quarantineRoleId
    ? guild.roles.cache.get(lockdown.quarantineRoleId)
    : null;
  if (!quarantineRole?.editable) {
    throw new Error('Configured quarantine role is missing or not assignable');
  }

  const removable = [...member.roles.cache.values()]
    .filter(role => role.id !== guild.id && role.id !== quarantineRole.id && role.editable && !role.managed)
    .slice(0, MAX_QUARANTINE_ROLES);
  const existing = lockdown.quarantinedMembers?.[member.id];
  const snapshot = existing?.roleIds?.length
    ? existing.roleIds
    : removable.map(role => role.id);

  await updateLockdownConfig(client, guild.id, current => ({
    ...current,
    quarantinedMembers: {
      ...current.quarantinedMembers,
      [member.id]: existing || {
        roleIds: snapshot,
        quarantinedAt: new Date().toISOString(),
        reason,
      },
    },
  }));

  if (removable.length > 0) await member.roles.remove(removable, reason);
  await member.roles.add(quarantineRole, reason);
  return { removedRoleIds: snapshot, bounded: removable.length === MAX_QUARANTINE_ROLES };
}

export async function unquarantineMember(client, guild, userId, reason = 'Quarantine lifted') {
  const lockdown = await getLockdownConfig(client, guild.id);
  const record = lockdown.quarantinedMembers?.[userId];
  if (!record) {
    return { success: false, notQuarantined: true, restoredRoleIds: [], missingRoleIds: [], failures: [] };
  }

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    // Still clear the record if they left the server.
    await updateLockdownConfig(client, guild.id, (current) => {
      const quarantinedMembers = { ...current.quarantinedMembers };
      delete quarantinedMembers[userId];
      const memberIds = current.bulkQuarantine.memberIds.filter((id) => id !== userId);
      return {
        ...current,
        quarantinedMembers,
        bulkQuarantine: {
          ...current.bulkQuarantine,
          active: memberIds.length > 0,
          memberIds,
        },
      };
    });
    return {
      success: true,
      leftServer: true,
      restoredRoleIds: [],
      missingRoleIds: record.roleIds || [],
      failures: [],
      record,
    };
  }

  const quarantineRoleId = lockdown.quarantineRoleId;
  const quarantineRole = quarantineRoleId ? guild.roles.cache.get(quarantineRoleId) : null;

  const restoredRoleIds = [];
  const missingRoleIds = [];
  const failures = [];

  for (const roleId of record.roleIds || []) {
    if (roleId === guild.id || roleId === quarantineRoleId) continue;
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      missingRoleIds.push(roleId);
      continue;
    }
    if (!role.editable || role.managed) {
      failures.push(`${role.name}: not assignable by the bot`);
      continue;
    }
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(role, reason);
      }
      restoredRoleIds.push(roleId);
    } catch (error) {
      failures.push(`${role.name}: ${error.message}`);
    }
  }

  if (quarantineRole && member.roles.cache.has(quarantineRole.id) && quarantineRole.editable) {
    try {
      await member.roles.remove(quarantineRole, reason);
    } catch (error) {
      failures.push(`quarantine role: ${error.message}`);
    }
  }

  if (failures.length === 0) {
    await updateLockdownConfig(client, guild.id, (current) => {
      const quarantinedMembers = { ...current.quarantinedMembers };
      delete quarantinedMembers[userId];
      const memberIds = current.bulkQuarantine.memberIds.filter((id) => id !== userId);
      return {
        ...current,
        quarantinedMembers,
        bulkQuarantine: {
          ...current.bulkQuarantine,
          active: memberIds.length > 0,
          memberIds,
        },
      };
    });
  }

  return {
    success: failures.length === 0,
    restoredRoleIds,
    missingRoleIds,
    failures,
    record,
    member,
  };
}

// Intentionally strict: only the server owner, bots, individually trusted
// users, and members Discord will not let this bot manage are spared. Trusted
// roles and permission levels do not provide an exemption by themselves.
function isBulkQuarantineExempt(client, guild, member, lockdown) {
  if (!member || member.user.bot) return true;
  if (member.id === guild.ownerId || member.id === client.user?.id) return true;
  // Discord will not let the bot safely strip a member whose highest role is
  // at or above its own. Skipping avoids removing only their harmless roles
  // while leaving the powerful, unmanageable role intact.
  if (!member.manageable) return true;
  return lockdown.trustedUserIds.includes(member.id);
}

export async function quarantineAllMembers(
  client,
  guild,
  reason = 'Emergency member quarantine',
) {
  const lockdown = await getLockdownConfig(client, guild.id);
  const quarantineRole = lockdown.quarantineRoleId
    ? guild.roles.cache.get(lockdown.quarantineRoleId)
    : null;
  if (!quarantineRole?.editable) {
    throw new Error('Configure an assignable quarantine role before quarantining members.');
  }
  if (lockdown.bulkQuarantine.active) {
    return {
      success: false,
      alreadyActive: true,
      attempted: 0,
      quarantined: 0,
      exempt: 0,
      failures: [],
    };
  }

  const members = await guild.members.fetch();
  const targets = [...members.values()].filter(
    (member) =>
      !lockdown.quarantinedMembers[member.id]
      && !isBulkQuarantineExempt(client, guild, member, lockdown),
  );
  const exempt = members.size - targets.length;
  const newRecords = {};
  const now = new Date().toISOString();

  for (const member of targets) {
    const roleIds = [...member.roles.cache.values()]
      .filter((role) =>
        role.id !== guild.id
        && role.id !== quarantineRole.id
        && role.editable
        && !role.managed)
      .slice(0, MAX_QUARANTINE_ROLES)
      .map((role) => role.id);
    newRecords[member.id] = {
      roleIds,
      quarantinedAt: now,
      reason,
    };
  }

  let acceptedIds = [];
  await updateLockdownConfig(client, guild.id, (current) => {
    acceptedIds = targets
      .map((member) => member.id)
      .filter((memberId) => !current.quarantinedMembers[memberId]);
    const acceptedRecords = Object.fromEntries(
      acceptedIds.map((memberId) => [memberId, newRecords[memberId]]),
    );
    return {
      ...current,
      quarantinedMembers: {
        ...current.quarantinedMembers,
        ...acceptedRecords,
      },
      bulkQuarantine: {
        active: acceptedIds.length > 0,
        createdAt: now,
        memberIds: acceptedIds,
      },
    };
  });

  const failures = [];
  let quarantined = 0;
  const acceptedSet = new Set(acceptedIds);
  const acceptedTargets = targets.filter((member) => acceptedSet.has(member.id));
  for (const member of acceptedTargets) {
    const record = newRecords[member.id];
    try {
      const removable = (record.roleIds || [])
        .map((id) => guild.roles.cache.get(id))
        .filter(Boolean);
      if (removable.length) await member.roles.remove(removable, reason);
      if (!member.roles.cache.has(quarantineRole.id)) {
        await member.roles.add(quarantineRole, reason);
      }
      quarantined += 1;
    } catch (error) {
      failures.push(`${member.user.tag} (${member.id}): ${error.message}`);
    }
  }

  return {
    success: failures.length === 0,
    attempted: acceptedTargets.length,
    quarantined,
    exempt: exempt + (targets.length - acceptedTargets.length),
    failures,
  };
}

export async function restoreAllQuarantinedMembers(
  client,
  guild,
  reason = 'Emergency member quarantine lifted',
) {
  const lockdown = await getLockdownConfig(client, guild.id);
  const userIds = [...new Set(lockdown.bulkQuarantine.memberIds)];
  if (!userIds.length) {
    return {
      success: false,
      notActive: true,
      attempted: 0,
      restored: 0,
      leftServer: 0,
      failures: [],
    };
  }

  const failures = [];
  const clearedIds = new Set();
  let restored = 0;
  let leftServer = 0;
  for (const userId of userIds) {
    const record = lockdown.quarantinedMembers[userId];
    if (!record) {
      clearedIds.add(userId);
      restored += 1;
      continue;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      clearedIds.add(userId);
      leftServer += 1;
      continue;
    }

    const assignableRoles = (record.roleIds || [])
      .map((roleId) => guild.roles.cache.get(roleId))
      .filter((role) => role?.editable && !role.managed);
    try {
      if (assignableRoles.length) await member.roles.add(assignableRoles, reason);
      const quarantineRole = lockdown.quarantineRoleId
        ? guild.roles.cache.get(lockdown.quarantineRoleId)
        : null;
      if (quarantineRole?.editable && member.roles.cache.has(quarantineRole.id)) {
        await member.roles.remove(quarantineRole, reason);
      }
      clearedIds.add(userId);
      restored += 1;
    } catch (error) {
      failures.push(`${member.user.tag} (${userId}): ${error.message}`);
    }
  }

  await updateLockdownConfig(client, guild.id, (current) => ({
    ...current,
    quarantinedMembers: Object.fromEntries(
      Object.entries(current.quarantinedMembers)
        .filter(([userId]) => !clearedIds.has(userId)),
    ),
    bulkQuarantine: (() => {
      const memberIds = current.bulkQuarantine.memberIds
        .filter((userId) => !clearedIds.has(userId));
      return {
        active: memberIds.length > 0,
        createdAt: memberIds.length ? current.bulkQuarantine.createdAt : null,
        memberIds,
      };
    })(),
  }));

  return {
    success: failures.length === 0,
    attempted: userIds.length,
    restored,
    leftServer,
    failures,
  };
}

export async function handleMemberJoinDuringLockdown(client, member) {
  if (!member?.guild || !member.user?.bot) return { ignored: 'not_bot' };
  const lockdown = await getLockdownConfig(client, member.guild.id);
  if (!lockdown.active || !lockdown.guards.blockNewBots) {
    return { ignored: 'guard_disabled' };
  }
  if (lockdown.trustedUserIds.includes(member.id)) return { ignored: 'trusted' };
  if (!member.kickable) {
    logger.warn('Lockdown could not block new bot due to role hierarchy', {
      guildId: member.guild.id,
      botId: member.id,
    });
    return { ignored: 'not_kickable' };
  }

  await member.kick('Lockdown guard: new bot joins are blocked');
  logger.warn('Lockdown blocked a new bot join', {
    guildId: member.guild.id,
    botId: member.id,
    botTag: member.user.tag,
  });
  return { blocked: true, botId: member.id };
}

export async function handleChannelCreateDuringLockdown(client, channel) {
  const guild = channel?.guild;
  if (
    !guild
    || !channel.permissionOverwrites?.cache
    || typeof channel.permissionOverwrites.set !== 'function'
  ) {
    return { ignored: 'unsupported_channel' };
  }

  const lockdown = await getLockdownConfig(client, guild.id);
  if (!lockdown.active || !lockdown.snapshot || !lockdown.guards.lockNewChannels) {
    return { ignored: 'guard_disabled' };
  }
  if (lockdown.snapshot.channels.some((item) => item.channelId === channel.id)) {
    return { ignored: 'already_snapshotted' };
  }
  if (lockdown.snapshot.channels.length >= MAX_LOCKDOWN_CHANNELS) {
    logger.warn('Lockdown new-channel guard skipped snapshot limit', {
      guildId: guild.id,
      channelId: channel.id,
    });
    return { ignored: 'snapshot_limit' };
  }

  const original = snapshotEveryoneOverwrite(channel, guild.roles.everyone.id);
  let snapshotSaved = false;
  await updateLockdownConfig(client, guild.id, (current) => {
    if (
      !current.active
      || !current.snapshot
      || current.snapshot.channels.length >= MAX_LOCKDOWN_CHANNELS
      || current.snapshot.channels.some((item) => item.channelId === channel.id)
    ) {
      return current;
    }
    snapshotSaved = true;
    return {
      ...current,
      snapshot: {
        ...current.snapshot,
        channels: [...current.snapshot.channels, original],
      },
    };
  });
  if (!snapshotSaved) return { ignored: 'lockdown_changed' };
  await replaceEveryoneOverwrite(
    channel,
    guild.roles.everyone.id,
    restrictOverwriteState(original, lockdown.restrictions),
    'Lockdown guard: restrict newly created channel',
  );
  return { locked: true, channelId: channel.id };
}

async function respondToAntiNukeTrigger(client, guild, {
  member,
  lockdown,
  reason,
  deletedChannelId = null,
  deletedRoleId = null,
  forceEnableAntiNuke = false,
}) {
  let activeLockdown = lockdown;

  if (forceEnableAntiNuke && !lockdown.antiNukeEnabled) {
    activeLockdown = await updateLockdownConfig(client, guild.id, current => ({
      ...current,
      antiNukeEnabled: true,
    }));
  }

  let quarantine;
  try {
    quarantine = await quarantineMember(client, guild, member, activeLockdown, reason);
  } catch (error) {
    logger.error('Anti-nuke quarantine failed', {
      guildId: guild.id,
      executorId: member.id,
      error: error.message,
    });
    quarantine = { error: error.message };
  }

  const lockdownResult = await engageLockdown(client, guild, activeLockdown.restrictions, reason)
    .catch(error => {
      logger.error('Anti-nuke lockdown failed', { guildId: guild.id, error: error.message });
      return { success: false, failures: [error.message] };
    });

  const alert = await sendAntiNukeAlert(client, guild, activeLockdown, {
    executor: member.user,
    reason,
    quarantine,
    lockdownResult,
    deletedChannelId,
    deletedRoleId,
  }).catch(error => {
    logger.error('Anti-nuke alert failed', { guildId: guild.id, error: error.message });
    return { alertPosted: false, error: error.message };
  });

  logger.warn('Anti-nuke threshold triggered', {
    guildId: guild.id,
    executorId: member.id,
    reason,
    quarantine,
    lockdown: lockdownResult,
    alert,
    antiNukeForcedOn: forceEnableAntiNuke,
  });

  return {
    triggered: true,
    executorId: member.id,
    quarantine,
    lockdown: lockdownResult,
    alert,
    antiNukeEnabled: activeLockdown.antiNukeEnabled === true,
  };
}

async function resolveAntiNukeExecutor(client, guild, lockdown, {
  auditType,
  targetId,
  now,
}) {
  let logs;
  try {
    logs = await guild.fetchAuditLogs({ type: auditType, limit: 6 });
  } catch (error) {
    logger.error('Anti-nuke audit log fetch failed', {
      guildId: guild.id,
      targetId,
      auditType,
      error: error.message,
    });
    return { ignored: 'audit_fetch_failed' };
  }

  const entry = selectUnambiguousAuditEntry(logs.entries.values(), targetId, now);
  if (!entry) {
    logger.warn('Anti-nuke skipped ambiguous deletion attribution', {
      guildId: guild.id,
      targetId,
      auditType,
    });
    return { ignored: 'ambiguous_attribution' };
  }

  let member;
  try {
    member = await guild.members.fetch(entry.executor.id);
  } catch (error) {
    logger.warn('Anti-nuke could not resolve audit executor member', {
      guildId: guild.id,
      executorId: entry.executor.id,
      error: error.message,
    });
    return { ignored: 'executor_unresolved' };
  }

  const trusted = isTrustedExecutor({
    executorId: entry.executor.id,
    ownerId: guild.ownerId,
    botId: client.user?.id,
    trustedUserIds: lockdown.trustedUserIds,
    trustedRoleIds: lockdown.trustedRoleIds,
    memberRoleIds: [...member.roles.cache.keys()],
  });
  if (trusted) return { ignored: 'trusted' };

  return { member, entry };
}

export async function handleChannelDeletion(client, channel, now = Date.now()) {
  const guild = channel?.guild;
  if (!guild) return { ignored: 'no_guild' };

  const lockdown = await getLockdownConfig(client, guild.id);
  if (!lockdown.antiNukeEnabled) return { ignored: 'disabled' };

  const resolved = await resolveAntiNukeExecutor(client, guild, lockdown, {
    auditType: AuditLogEvent.ChannelDelete,
    targetId: channel.id,
    now,
  });
  if (resolved.ignored) return resolved;

  const key = `channel:${guild.id}:${resolved.member.id}`;
  const counter = recordDeletion(channelDeletionWindows, key, now, {
    windowMs: ANTI_NUKE_WINDOW_MS,
    threshold: ANTI_NUKE_THRESHOLD,
  });
  if (!counter.triggered) return { ignored: 'below_threshold', count: counter.count };

  channelDeletionWindows.delete(key);
  return respondToAntiNukeTrigger(client, guild, {
    member: resolved.member,
    lockdown,
    reason: `Anti-nuke: ${counter.count} channel deletions within 10 minutes`,
    deletedChannelId: channel.id,
  });
}

export async function handleRoleDeletion(client, role, now = Date.now()) {
  const guild = role?.guild;
  if (!guild) return { ignored: 'no_guild' };

  let lockdown = await getLockdownConfig(client, guild.id);
  // Role mass-delete always watches when a quarantine role is configured,
  // and will force-enable anti-nuke on trigger for safety.
  if (!lockdown.quarantineRoleId) return { ignored: 'no_quarantine_role' };

  const resolved = await resolveAntiNukeExecutor(client, guild, lockdown, {
    auditType: AuditLogEvent.RoleDelete,
    targetId: role.id,
    now,
  });
  if (resolved.ignored) return resolved;

  const key = `role:${guild.id}:${resolved.member.id}`;
  const counter = recordDeletion(roleDeletionWindows, key, now, {
    windowMs: ANTI_NUKE_ROLE_WINDOW_MS,
    threshold: ANTI_NUKE_ROLE_THRESHOLD,
  });
  if (!counter.triggered) return { ignored: 'below_threshold', count: counter.count };

  roleDeletionWindows.delete(key);
  return respondToAntiNukeTrigger(client, guild, {
    member: resolved.member,
    lockdown,
    reason: `Anti-nuke: ${counter.count} role deletions within 1 minute`,
    deletedRoleId: role.id,
    forceEnableAntiNuke: true,
  });
}
