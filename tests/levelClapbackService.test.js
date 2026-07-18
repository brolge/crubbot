import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_CLAPBACKS,
  isRudeLevelReply,
  registerLevelUpAnnouncement,
} from '../src/services/levelClapbackService.js';

test('level clapback pool contains exactly 50 distinct responses', () => {
  assert.equal(LEVEL_CLAPBACKS.length, 50);
  assert.equal(new Set(LEVEL_CLAPBACKS).size, 50);
});

test('rude replies are recognized only for registered level announcements', () => {
  registerLevelUpAnnouncement({
    id: 'announcement-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
  });

  assert.equal(isRudeLevelReply({
    guildId: 'guild-1',
    channelId: 'channel-1',
    reference: { messageId: 'announcement-1' },
    content: 'shut up bot',
  }), true);
  assert.equal(isRudeLevelReply({
    guildId: 'guild-1',
    channelId: 'channel-2',
    reference: { messageId: 'announcement-1' },
    content: 'shut up bot',
  }), false);
  assert.equal(isRudeLevelReply({
    guildId: 'guild-1',
    channelId: 'channel-1',
    reference: { messageId: 'unregistered' },
    content: 'shut up bot',
  }), false);
});

test('normal replies to level announcements do not trigger clapbacks', () => {
  registerLevelUpAnnouncement({
    id: 'announcement-2',
    guildId: 'guild-1',
    channelId: 'channel-1',
  });

  assert.equal(isRudeLevelReply({
    guildId: 'guild-1',
    channelId: 'channel-1',
    reference: { messageId: 'announcement-2' },
    content: 'congratulations!',
  }), false);
});
