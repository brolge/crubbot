import {
  AuditLogEvent,
  OverwriteType,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_RESTRICTIONS,
  buildRestrictionMask,
  isTrustedExecutor,
  normalizeLockdownConfig,
  recordDeletion,
  restrictOverwriteState,
  selectUnambiguousAuditEntry,
} from './lockdownPolicy.js';

export const MAX_LOCKDOWN_CHANNELS = 500;
export const MAX_QUARANTINE_ROLES = 250;

const deletionWindows = new Map();
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

export async function handleChannelDeletion(client, channel, now = Date.now()) {
  const guild = channel?.guild;
  if (!guild) return { ignored: 'no_guild' };

  const lockdown = await getLockdownConfig(client, guild.id);
  if (!lockdown.antiNukeEnabled) return { ignored: 'disabled' };

  let logs;
  try {
    logs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 6 });
  } catch (error) {
    logger.error('Anti-nuke audit log fetch failed', { guildId: guild.id, channelId: channel.id, error: error.message });
    return { ignored: 'audit_fetch_failed' };
  }

  const entry = selectUnambiguousAuditEntry(logs.entries.values(), channel.id, now);
  if (!entry) {
    logger.warn('Anti-nuke skipped ambiguous channel deletion attribution', { guildId: guild.id, channelId: channel.id });
    return { ignored: 'ambiguous_attribution' };
  }

  let member;
  try {
    member = await guild.members.fetch(entry.executor.id);
  } catch (error) {
    logger.warn('Anti-nuke could not resolve audit executor member', { guildId: guild.id, executorId: entry.executor.id, error: error.message });
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

  const key = `${guild.id}:${entry.executor.id}`;
  const counter = recordDeletion(deletionWindows, key, now);
  if (!counter.triggered) return { ignored: 'below_threshold', count: counter.count };

  deletionWindows.delete(key);
  const reason = `Anti-nuke: ${counter.count} channel deletions within 10 minutes`;
  let quarantine;
  try {
    quarantine = await quarantineMember(client, guild, member, lockdown, reason);
  } catch (error) {
    logger.error('Anti-nuke quarantine failed', { guildId: guild.id, executorId: entry.executor.id, error: error.message });
    quarantine = { error: error.message };
  }

  const lockdownResult = await engageLockdown(client, guild, lockdown.restrictions, reason)
    .catch(error => {
      logger.error('Anti-nuke lockdown failed', { guildId: guild.id, error: error.message });
      return { success: false, failures: [error.message] };
    });

  logger.warn('Anti-nuke threshold triggered', {
    guildId: guild.id,
    executorId: entry.executor.id,
    quarantine,
    lockdown: lockdownResult,
  });
  return { triggered: true, executorId: entry.executor.id, quarantine, lockdown: lockdownResult };
}
