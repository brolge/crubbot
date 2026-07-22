import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWelcomeQuote, BUILTIN_WELCOME_QUOTES } from '../src/utils/welcome.js';

test('pickWelcomeQuote returns null when quotes disabled', () => {
  assert.equal(pickWelcomeQuote({ quotesEnabled: false, quotes: ['Hello'] }), null);
});

test('pickWelcomeQuote uses custom quotes when enabled', () => {
  const quote = pickWelcomeQuote({ quotesEnabled: true, quotes: ['Custom only'] });
  assert.equal(quote, 'Custom only');
});

test('pickWelcomeQuote falls back to built-in pool', () => {
  const quote = pickWelcomeQuote({ quotesEnabled: true, quotes: [] });
  assert.ok(BUILTIN_WELCOME_QUOTES.includes(quote));
});
