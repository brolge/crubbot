import { BotConfig } from '../config/bot.js';

function normalizedOwnerIds() {
  return (BotConfig.commands?.owners || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export function isBotOwner(userId) {
  if (!userId) return false;
  return normalizedOwnerIds().includes(String(userId));
}

export function getOwnerIds() {
  return normalizedOwnerIds();
}
