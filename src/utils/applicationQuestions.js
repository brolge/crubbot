export const MAX_APPLICATION_QUESTIONS = 25;
export const QUESTIONS_PER_MODAL_PAGE = 5;
export const MAX_QUESTION_PROMPT = 100;
export const MAX_ANSWER_LENGTH = 1000;
export const APPLICATION_DRAFT_TTL_MS = 30 * 60 * 1000;

export function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) return [];

  const prompts = [];
  for (const entry of raw) {
    const prompt = typeof entry === 'string'
      ? entry.trim()
      : typeof entry?.prompt === 'string'
        ? entry.prompt.trim()
        : '';
    if (!prompt) continue;
    prompts.push(prompt.slice(0, MAX_QUESTION_PROMPT));
    if (prompts.length >= MAX_APPLICATION_QUESTIONS) break;
  }
  return prompts;
}

export function resolveApplicationQuestions(roleSettings = {}, globalSettings = {}) {
  const roleQuestions = normalizeQuestions(roleSettings?.questions);
  if (roleQuestions.length > 0) return roleQuestions;

  const globalQuestions = normalizeQuestions(globalSettings?.questions);
  if (globalQuestions.length > 0) return globalQuestions;

  return [
    'Why do you want this role?',
    'What experience do you have?',
  ];
}

export function getQuestionPageCount(questions) {
  const total = normalizeQuestions(questions).length;
  return Math.max(1, Math.ceil(total / QUESTIONS_PER_MODAL_PAGE));
}

export function getQuestionsForPage(questions, page) {
  const normalized = normalizeQuestions(questions);
  const start = page * QUESTIONS_PER_MODAL_PAGE;
  return normalized.slice(start, start + QUESTIONS_PER_MODAL_PAGE).map((prompt, index) => ({
    prompt,
    absoluteIndex: start + index,
  }));
}

export function truncateModalTitle(title) {
  const value = String(title || 'Application').trim();
  return value.length > 45 ? `${value.slice(0, 42)}...` : value;
}

export function formatQuestionLabel(prompt, absoluteIndex) {
  const prefix = `Q${absoluteIndex + 1}: `;
  const maxPrompt = Math.max(1, 45 - prefix.length);
  const body = prompt.length > maxPrompt ? `${prompt.slice(0, Math.max(0, maxPrompt - 3))}...` : prompt;
  return `${prefix}${body}`;
}

export function chunkAnswersForEmbed(answers, perPage = 8) {
  const items = Array.isArray(answers) ? answers : [];
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages.length ? pages : [[]];
}
