import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApplicationDraft,
  getActiveApplicationDraftForUser,
  setDraftAnswer,
  draftAnswersComplete,
  deleteApplicationDraft,
} from '../src/services/applicationWizard.js';

test('DM interview draft tracks one active session per user', () => {
  const first = createApplicationDraft({
    guildId: 'guild-1',
    guildName: 'Test Guild',
    userId: 'user-1',
    roleId: 'role-1',
    roleName: 'Staff',
    questions: ['Why?', 'Experience?'],
  });
  const second = createApplicationDraft({
    guildId: 'guild-1',
    guildName: 'Test Guild',
    userId: 'user-1',
    roleId: 'role-1',
    roleName: 'Staff',
    questions: ['Why again?'],
  });

  assert.equal(getActiveApplicationDraftForUser('user-1')?.draftId, second.draftId);
  assert.notEqual(first.draftId, second.draftId);
  deleteApplicationDraft(second.draftId);
});

test('DM interview answers complete when every question is filled', () => {
  const draft = createApplicationDraft({
    guildId: 'guild-1',
    guildName: 'Test Guild',
    userId: 'user-2',
    roleId: 'role-1',
    roleName: 'Staff',
    questions: ['Why?', 'Experience?'],
  });

  setDraftAnswer(draft, 0, 'I want to help the community.');
  assert.equal(draftAnswersComplete(draft), false);
  setDraftAnswer(draft, 1, 'I moderated another server for a year.');
  assert.equal(draftAnswersComplete(draft), true);
  deleteApplicationDraft(draft.draftId);
});
