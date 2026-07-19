import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionOverwrites } from 'discord.js';
import {
  applyQuarantineRoleToChannel,
  QUARANTINE_CHANNEL_DENIES,
} from '../src/services/lockdownService.js';

test('quarantine overwrite denies every configured channel permission', () => {
  assert.equal(QUARANTINE_CHANNEL_DENIES.ViewChannel, false);
  assert.equal(QUARANTINE_CHANNEL_DENIES.SendMessages, false);
  assert.equal(QUARANTINE_CHANNEL_DENIES.Connect, false);
  assert.equal(QUARANTINE_CHANNEL_DENIES.Speak, false);

  const unknown = Object.keys(QUARANTINE_CHANNEL_DENIES)
    .filter((permission) => PermissionFlagsBits[permission] === undefined);
  assert.deepEqual(unknown, []);
  assert.doesNotThrow(() => {
    PermissionOverwrites.resolveOverwriteOptions(
      QUARANTINE_CHANNEL_DENIES,
      { allow: 0n, deny: 0n },
    );
  });
});

test('quarantine channel enforcement writes the strict role overwrite', async () => {
  const calls = [];
  const channel = {
    permissionOverwrites: {
      cache: new Map(),
      edit: async (...args) => calls.push(args),
    },
  };
  const role = { id: 'quarantine-role' };

  const applied = await applyQuarantineRoleToChannel(
    channel,
    role,
    'test quarantine enforcement',
  );

  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], role);
  assert.equal(calls[0][1], QUARANTINE_CHANNEL_DENIES);
  assert.deepEqual(calls[0][2], { reason: 'test quarantine enforcement' });
});
