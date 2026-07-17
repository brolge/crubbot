import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresetPatch,
  buildOverwritePatch,
  QUICK_PRESETS,
} from '../src/services/channelPermsService.js';

test('quick presets deny messaging and reactions', () => {
  const mute = buildPresetPatch('muteOnly', false);
  assert.equal(mute.SendMessages, false);
  assert.equal(mute.AddReactions, false);
  assert.equal(mute.ViewChannel, undefined);

  const exception = buildPresetPatch('muteOnly', true);
  assert.equal(exception.SendMessages, true);
  assert.equal(exception.AddReactions, true);
});

test('lock preset hides the channel for the target role', () => {
  const lock = buildPresetPatch('lockChannel', false);
  assert.equal(lock.ViewChannel, false);
  assert.equal(lock.SendMessages, false);
  assert.equal(lock.AddReactions, false);
  assert.ok(QUICK_PRESETS.lockChannel);
});

test('buildOverwritePatch maps tri-state values', () => {
  assert.deepEqual(buildOverwritePatch({
    SendMessages: 'deny',
    AddReactions: 'allow',
    ViewChannel: 'inherit',
  }), {
    ViewChannel: null,
    SendMessages: false,
    AddReactions: true,
  });
});
