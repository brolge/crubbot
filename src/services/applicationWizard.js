import { randomBytes } from 'node:crypto';
import { APPLICATION_DRAFT_TTL_MS } from '../utils/applicationQuestions.js';

const draftsById = new Map();
const activeDraftByUser = new Map();

function purgeExpired(now = Date.now()) {
  for (const [draftId, draft] of draftsById.entries()) {
    if (!draft?.expiresAt || draft.expiresAt <= now) {
      draftsById.delete(draftId);
      if (activeDraftByUser.get(draft.userId) === draftId) {
        activeDraftByUser.delete(draft.userId);
      }
    }
  }
}

export function createApplicationDraft({
  guildId,
  guildName,
  userId,
  roleId,
  roleName,
  questions,
}) {
  purgeExpired();
  const existingId = activeDraftByUser.get(userId);
  if (existingId) {
    draftsById.delete(existingId);
    activeDraftByUser.delete(userId);
  }

  const draftId = randomBytes(4).toString('hex');
  const draft = {
    draftId,
    guildId,
    guildName: guildName || null,
    userId,
    roleId,
    roleName,
    questions: [...questions],
    answers: new Array(questions.length).fill(null),
    currentQuestion: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + APPLICATION_DRAFT_TTL_MS,
  };
  draftsById.set(draftId, draft);
  activeDraftByUser.set(userId, draftId);
  return draft;
}

export function getApplicationDraft(draftId) {
  purgeExpired();
  return draftsById.get(draftId) || null;
}

export function getActiveApplicationDraftForUser(userId) {
  purgeExpired();
  const draftId = activeDraftByUser.get(userId);
  if (!draftId) return null;
  return draftsById.get(draftId) || null;
}

export function saveApplicationDraft(draft) {
  if (!draft?.draftId) return null;
  draft.expiresAt = Date.now() + APPLICATION_DRAFT_TTL_MS;
  draftsById.set(draft.draftId, draft);
  activeDraftByUser.set(draft.userId, draft.draftId);
  return draft;
}

export function deleteApplicationDraft(draftId) {
  const draft = draftsById.get(draftId);
  draftsById.delete(draftId);
  if (draft && activeDraftByUser.get(draft.userId) === draftId) {
    activeDraftByUser.delete(draft.userId);
  }
}

export function setDraftAnswer(draft, questionIndex, answer) {
  draft.answers[questionIndex] = {
    question: draft.questions[questionIndex],
    answer: String(answer || '').trim(),
  };
  return draft;
}

export function draftAnswersComplete(draft) {
  return Array.isArray(draft?.answers)
    && draft.answers.length === draft.questions.length
    && draft.answers.every((entry) => entry?.answer);
}

// Kept for older modal wizard callers/tests that still import the helper.
export function setDraftPageAnswers(draft, pageQuestions, valuesByCustomId) {
  for (const question of pageQuestions) {
    const value = valuesByCustomId[`q${question.absoluteIndex}`];
    setDraftAnswer(draft, question.absoluteIndex, value);
  }
  return draft;
}
