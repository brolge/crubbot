import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEventLogChannelId } from '../src/utils/logDestinations.js';

test('routes events to category destinations before audit fallback', () => {
  const config = {
    logging: {
      channels: {
        audit: 'audit-channel',
        message: 'message-channel',
        moderation: 'mod-channel',
      },
    },
  };

  assert.equal(resolveEventLogChannelId(config, 'message.delete'), 'message-channel');
  assert.equal(resolveEventLogChannelId(config, 'moderation.ban'), 'mod-channel');
  assert.equal(resolveEventLogChannelId(config, 'leveling.levelup'), 'audit-channel');
});

test('prefers per-event overrides over category destinations', () => {
  const config = {
    logging: {
      channels: {
        message: 'message-channel',
        audit: 'audit-channel',
      },
      eventChannels: {
        'message.delete': 'delete-only-channel',
      },
    },
  };

  assert.equal(resolveEventLogChannelId(config, 'message.delete'), 'delete-only-channel');
  assert.equal(resolveEventLogChannelId(config, 'message.edit'), 'message-channel');
});

test('explicit override argument wins', () => {
  const config = {
    logging: {
      channels: { bot: 'bot-channel' },
      eventChannels: { 'security.antinuke': 'event-override' },
    },
  };

  assert.equal(
    resolveEventLogChannelId(config, 'security.antinuke', 'manual-alert'),
    'manual-alert',
  );
});
