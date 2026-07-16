import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANAGED_CHANNEL_PERMISSIONS,
  applyPermissionTemplate,
  buildBulkApplyPreview,
  buildPermissionOverwrite,
  createPermissionTemplate,
  deletePermissionTemplate,
  listPermissionTemplates,
  updatePermissionTemplate,
} from '../src/services/channelPermissionTemplateService.js';

function createClient(initialConfig = {}) {
  const values = new Map([['guild:test:config', initialConfig]]);
  return {
    values,
    db: {
      async get(key, fallback) {
        return values.has(key) ? structuredClone(values.get(key)) : fallback;
      },
      async set(key, value) {
        values.set(key, structuredClone(value));
      },
    },
  };
}

test('permission template CRUD persists in guild config', async () => {
  const client = createClient({ unrelatedSetting: 'preserved' });
  const created = await createPermissionTemplate(client, 'test', {
    name: 'Members',
    permissions: { ViewChannel: 'allow', SendMessages: 'deny' },
  });

  assert.equal(created.permissions.ViewChannel, 'allow');
  assert.equal(created.permissions.SendMessages, 'deny');
  assert.equal(created.permissions.AddReactions, 'inherit');
  assert.equal((await listPermissionTemplates(client, 'test')).length, 1);

  const updated = await updatePermissionTemplate(client, 'test', created.id, {
    name: 'Trusted Members',
    permissions: { ManageMessages: 'allow' },
  });
  assert.equal(updated.name, 'Trusted Members');
  assert.equal(updated.permissions.ManageMessages, 'allow');
  assert.equal(updated.permissions.ViewChannel, 'inherit');

  await deletePermissionTemplate(client, 'test', created.id);
  assert.deepEqual(await listPermissionTemplates(client, 'test'), []);
  assert.equal(client.values.get('guild:test:config').unrelatedSetting, 'preserved');
});

test('permission templates reject duplicate names', async () => {
  const client = createClient();
  await createPermissionTemplate(client, 'test', { name: 'Moderators' });
  await assert.rejects(
    createPermissionTemplate(client, 'test', { name: ' moderators ' }),
    /already exists/,
  );
});

test('buildPermissionOverwrite contains only managed permission keys', () => {
  const overwrite = buildPermissionOverwrite({
    permissions: {
      ViewChannel: 'allow',
      SendMessages: 'deny',
      Administrator: 'allow',
    },
  });

  assert.deepEqual(Object.keys(overwrite), [...MANAGED_CHANNEL_PERMISSIONS]);
  assert.equal(overwrite.ViewChannel, true);
  assert.equal(overwrite.SendMessages, false);
  assert.equal(overwrite.ReadMessageHistory, null);
  assert.equal('Administrator' in overwrite, false);
});

test('bulk preview deduplicates targets and enforces 100 edit cap', () => {
  const template = { id: 'one', name: 'One', permissions: {} };
  const preview = buildBulkApplyPreview(template, ['r1', 'r1', 'r2'], ['c1', 'c1']);
  assert.equal(preview.editCount, 2);

  assert.throws(
    () => buildBulkApplyPreview(
      template,
      Array.from({ length: 11 }, (_, index) => `r${index}`),
      Array.from({ length: 10 }, (_, index) => `c${index}`),
    ),
    /maximum is 100/,
  );
});

test('applyPermissionTemplate preserves unmanaged bits by sending managed keys only', async () => {
  const calls = [];
  const guild = {
    roles: { cache: new Map([['r1', { id: 'r1' }], ['r2', { id: 'r2' }]]) },
    channels: {
      cache: new Map([['c1', {
        permissionOverwrites: {
          async edit(roleId, overwrite) {
            calls.push({ roleId, overwrite });
          },
        },
      }]]),
    },
  };
  const template = {
    id: 'template',
    name: 'Template',
    permissions: { ViewChannel: 'allow', AddReactions: 'deny' },
  };

  const result = await applyPermissionTemplate(guild, template, ['r1', 'r2'], ['c1']);
  assert.equal(result.applied, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(calls[0].overwrite), [...MANAGED_CHANNEL_PERMISSIONS]);
  assert.equal(calls[0].overwrite.ViewChannel, true);
  assert.equal(calls[0].overwrite.AddReactions, false);
});
