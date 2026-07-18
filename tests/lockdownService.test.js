import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';

import {
  ANTI_NUKE_THRESHOLD,
  ANTI_NUKE_WINDOW_MS,
  ANTI_NUKE_ROLE_THRESHOLD,
  ANTI_NUKE_ROLE_WINDOW_MS,
  buildRestrictionMask,
  isTrustedExecutor,
  normalizeLockdownConfig,
  recordDeletion,
  restrictOverwriteState,
  selectUnambiguousAuditEntry,
} from '../src/services/lockdownPolicy.js';

test('recordDeletion triggers only on fourth deletion inside rolling window', () => {
  const state = new Map();
  const start = 1_000_000;

  for (let index = 0; index < ANTI_NUKE_THRESHOLD - 1; index += 1) {
    const result = recordDeletion(state, 'actor', start + index);
    assert.equal(result.triggered, false);
  }

  const fourth = recordDeletion(state, 'actor', start + 3);
  assert.deepEqual(fourth, { count: 4, triggered: true });
});

test('recordDeletion expires deletions outside ten minute rolling window', () => {
  const state = new Map([['actor', [1, 2, 3]]]);
  const result = recordDeletion(state, 'actor', ANTI_NUKE_WINDOW_MS + 2);

  assert.deepEqual(result, { count: 2, triggered: false });
});

test('role mass-delete triggers on fourth deletion inside one minute', () => {
  const state = new Map();
  const start = 5_000_000;

  for (let index = 0; index < ANTI_NUKE_ROLE_THRESHOLD - 1; index += 1) {
    const result = recordDeletion(state, 'actor', start + index, {
      windowMs: ANTI_NUKE_ROLE_WINDOW_MS,
      threshold: ANTI_NUKE_ROLE_THRESHOLD,
    });
    assert.equal(result.triggered, false);
  }

  const fourth = recordDeletion(state, 'actor', start + 3, {
    windowMs: ANTI_NUKE_ROLE_WINDOW_MS,
    threshold: ANTI_NUKE_ROLE_THRESHOLD,
  });
  assert.deepEqual(fourth, { count: 4, triggered: true });
});

test('role mass-delete window is one minute', () => {
  const state = new Map([['actor', [1, 2, 3]]]);
  const result = recordDeletion(state, 'actor', ANTI_NUKE_ROLE_WINDOW_MS + 2, {
    windowMs: ANTI_NUKE_ROLE_WINDOW_MS,
    threshold: ANTI_NUKE_ROLE_THRESHOLD,
  });
  assert.deepEqual(result, { count: 2, triggered: false });
});

test('selectUnambiguousAuditEntry requires one recent exact target match', () => {
  const now = 100_000;
  const exact = { target: { id: 'channel' }, executor: { id: 'actor' }, createdTimestamp: now - 500 };
  const unrelated = { target: { id: 'other' }, executor: { id: 'actor' }, createdTimestamp: now - 100 };

  assert.equal(selectUnambiguousAuditEntry([exact, unrelated], 'channel', now), exact);
  assert.equal(selectUnambiguousAuditEntry([exact, { ...exact }], 'channel', now), null);
  assert.equal(selectUnambiguousAuditEntry([{ ...exact, createdTimestamp: now - 30_000 }], 'channel', now), null);
});

test('trusted executor checks owner, bot, users, and member roles', () => {
  const base = {
    ownerId: 'owner',
    botId: 'bot',
    trustedUserIds: ['user'],
    trustedRoleIds: ['role'],
    memberRoleIds: [],
  };

  assert.equal(isTrustedExecutor({ ...base, executorId: 'owner' }), true);
  assert.equal(isTrustedExecutor({ ...base, executorId: 'bot' }), true);
  assert.equal(isTrustedExecutor({ ...base, executorId: 'user' }), true);
  assert.equal(isTrustedExecutor({ ...base, executorId: 'other', memberRoleIds: ['role'] }), true);
  assert.equal(isTrustedExecutor({ ...base, executorId: 'other' }), false);
  assert.equal(isTrustedExecutor({ ...base, executorId: null }), true);
});

test('restriction mask contains only selected lockdown permissions', () => {
  const mask = buildRestrictionMask({
    messaging: true,
    reactions: false,
    publicThreads: false,
    privateThreads: false,
    threadMessages: true,
  });

  assert.notEqual(mask & PermissionFlagsBits.SendMessages, 0n);
  assert.notEqual(mask & PermissionFlagsBits.SendMessagesInThreads, 0n);
  assert.equal(mask & PermissionFlagsBits.AddReactions, 0n);
});

test('restrictOverwriteState preserves unmanaged bits and exact source state', () => {
  const source = {
    existed: false,
    allow: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString(),
    deny: PermissionFlagsBits.ManageChannels.toString(),
  };
  const restricted = restrictOverwriteState(source, {
    messaging: true,
    reactions: false,
    publicThreads: false,
    privateThreads: false,
    threadMessages: false,
  });

  assert.deepEqual(source, {
    existed: false,
    allow: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString(),
    deny: PermissionFlagsBits.ManageChannels.toString(),
  });
  assert.equal(BigInt(restricted.allow) & PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ViewChannel);
  assert.equal(BigInt(restricted.allow) & PermissionFlagsBits.SendMessages, 0n);
  assert.equal(BigInt(restricted.deny) & PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageChannels);
  assert.equal(BigInt(restricted.deny) & PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessages);
});

test('normalizeLockdownConfig supplies safe defaults and deduplicates trust lists', () => {
  const config = normalizeLockdownConfig({
    antiNukeEnabled: true,
    trustedUserIds: ['one', 'one', 'two'],
    restrictions: { reactions: false },
  });

  assert.equal(config.antiNukeEnabled, true);
  assert.equal(config.alertChannelId, null);
  assert.deepEqual(config.trustedUserIds, ['one', 'two']);
  assert.equal(config.restrictions.messaging, true);
  assert.equal(config.restrictions.reactions, false);
  assert.equal(config.active, false);
  assert.deepEqual(config.bulkQuarantine, {
    active: false,
    createdAt: null,
    memberIds: [],
  });
  assert.deepEqual(config.guards, {
    blockNewBots: false,
    lockNewChannels: true,
  });
});

test('normalizeLockdownConfig preserves bulk quarantine and guard controls', () => {
  const config = normalizeLockdownConfig({
    bulkQuarantine: {
      active: true,
      createdAt: '2026-07-18T00:00:00.000Z',
      memberIds: ['one', 'one', 'two'],
    },
    guards: {
      blockNewBots: true,
      lockNewChannels: false,
    },
  });

  assert.deepEqual(config.bulkQuarantine.memberIds, ['one', 'two']);
  assert.equal(config.bulkQuarantine.active, true);
  assert.equal(config.guards.blockNewBots, true);
  assert.equal(config.guards.lockNewChannels, false);
});
