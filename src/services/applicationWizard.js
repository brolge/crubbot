import { randomBytes } from 'node:crypto';
import { APPLICATION_DRAFT_TTL_MS } from '../utils/applicationQuestions.js';

const drafts = new Map();

function purgeExpired(now = Date.now()) {
  for (const [draftId, draft] of drafts.entries()) {
    if (!draft?.expiresAt || draft.expiresAt <= now) {
      drafts.delete(draftId);
    }
  }
}

export function createApplicationDraft({
  guildId,
  userId,
  roleId,
  roleName,
  questions,
}) {
  purgeExpired();
  const draftId = randomBytes(4).toString('hex');
  const draft = {
    draftId,
    guildId,
    userId,
    roleId,
    roleName,
    questions: [...questions],
    answers: new Array(questions.length).fill(null),
    page: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + APPLICATION_DRAFT_TTL_MS,
  };
  drafts.set(draftId, draft);
  return draft;
}

export function getApplicationDraft(draftId) {
  purgeExpired();
  return drafts.get(draftId) || null;
}

export function saveApplicationDraft(draft) {
  if (!draft?.draftId) return null;
  draft.expiresAt = Date.now() + APPLICATION_DRAFT_TTL_MS;
  drafts.set(draft.draftId, draft);
  return draft;
}

export function deleteApplicationDraft(draftId) {
  drafts.delete(draftId);
}

export function setDraftPageAnswers(draft, pageQuestions, valuesByCustomId) {
  for (const question of pageQuestions) {
    const value = valuesByCustomId[`q${question.absoluteIndex}`];
    draft.answers[question.absoluteIndex] = {
      question: question.prompt,
      answer: String(value || '').trim(),
    };
  }
  return draft;
}

export function draftAnswersComplete(draft) {
  return Array.isArray(draft?.answers)
    && draft.answers.length === draft.questions.length
    && draft.answers.every((entry) => entry?.answer);
}
