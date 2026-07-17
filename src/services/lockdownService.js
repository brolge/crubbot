import {
  AuditLogEvent,
  ChannelType,
  OverwriteType,
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
  const snapshot = removable.map(role => role.id);

  await updateLockdownConfig(client, guild.id, current => ({
    ...current,
    quarantinedMembers: {
      ...current.quarantinedMembers,
      [member.id]: { roleIds: snapshot, quarantinedAt: new Date().toISOString(), reason },
    },
  }));

  if (removable.length > 0) await member.roles.remove(removable, reason);
  await member.roles.add(quarantineRole, reason);
  return { removedRoleIds: snapshot, bounded: removable.length === MAX_QUARANTINE_ROLES };
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
