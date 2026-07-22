import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_CLAPBACKS,
  containsInsult,
  isRudeLevelReply,
  registerLevelUpAnnouncement,
} from '../src/services/levelClapbackService.js';

test('level clapback pool has unique responses', () => {
  assert.ok(LEVEL_CLAPBACKS.length >= 50);
  assert.equal(new Set(LEVEL_CLAPBACKS).size, LEVEL_CLAPBACKS.length);
});

test('containsInsult catches creative and leetspeak insults', () => {
  assert.equal(containsInsult('moron'), true);
  assert.equal(containsInsult('you are a m0r0n'), true);
  assert.equal(containsInsult('stfu bot'), true);
  assert.equal(containsInsult('idiotdddd'), true);
  assert.equal(containsInsult('congratulations!'), false);
  assert.equal(containsInsult('nice level'), false);
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
    channelId: 'channel-1',
    reference: { messageId: 'announcement-1' },
    content: 'moron',
  }), true);
  assert.equal(isRudeLevelReply({
    guildId: 'guild-1',
    channelId: 'channel-2',
    reference: { messageId: 'announcement-1' },
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
