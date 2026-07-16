import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_APPLICATION_QUESTIONS,
  QUESTIONS_PER_MODAL_PAGE,
  normalizeQuestions,
  resolveApplicationQuestions,
  getQuestionPageCount,
  getQuestionsForPage,
  chunkAnswersForEmbed,
  formatQuestionLabel,
} from '../src/utils/applicationQuestions.js';

test('normalizeQuestions trims, drops empties, and caps at 25', () => {
  const input = [
    '  Why?  ',
    '',
    { prompt: ' Experience? ' },
    null,
    ...Array.from({ length: 30 }, (_, i) => `Q${i + 1}`),
  ];

  const result = normalizeQuestions(input);
  assert.equal(result[0], 'Why?');
  assert.equal(result[1], 'Experience?');
  assert.equal(result.length, MAX_APPLICATION_QUESTIONS);
});

test('resolveApplicationQuestions prefers role questions then global then defaults', () => {
  assert.deepEqual(
    resolveApplicationQuestions({ questions: ['Role Q'] }, { questions: ['Global Q'] }),
    ['Role Q'],
  );
  assert.deepEqual(
    resolveApplicationQuestions({}, { questions: ['Global Q'] }),
    ['Global Q'],
  );
  assert.equal(resolveApplicationQuestions({}, {}).length, 2);
});

test('paging uses five questions per Discord modal page', () => {
  const questions = Array.from({ length: 12 }, (_, i) => `Question ${i + 1}`);
  assert.equal(QUESTIONS_PER_MODAL_PAGE, 5);
  assert.equal(getQuestionPageCount(questions), 3);

  const page1 = getQuestionsForPage(questions, 1);
  assert.equal(page1.length, 5);
  assert.equal(page1[0].absoluteIndex, 5);
  assert.equal(page1[0].prompt, 'Question 6');
});

test('chunkAnswersForEmbed paginates review fields', () => {
  const answers = Array.from({ length: 20 }, (_, i) => ({
    question: `Q${i + 1}`,
    answer: `A${i + 1}`,
  }));
  const pages = chunkAnswersForEmbed(answers, 8);
  assert.equal(pages.length, 3);
  assert.equal(pages[0].length, 8);
  assert.equal(pages[2].length, 4);
});

test('formatQuestionLabel stays within modal label limits', () => {
  const label = formatQuestionLabel('x'.repeat(80), 9);
  assert.ok(label.startsWith('Q10: '));
  assert.ok(label.length <= 45);
});
