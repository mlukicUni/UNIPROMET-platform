import fs from 'fs';
import path from 'path';
import { getDb } from './sqlite';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - AI PLATFORMA (Uni AI + AI administracija)
 * Šema AI jezgra. Plan: docs/AI_PLATFORMA_PLAN.md
 * ==========================================================================
 */

/**
 * F0: uklanjanje NOLEKO prototipa „AI agent prototip" (jednom, na svakom serveru).
 * Brišu se njegove tabele, prava u rolama i prazan radni folder CLI-ja.
 * Nove AI tabele namerno nemaju imena ai_conversations / ai_messages.
 */
function removeNolekoPrototype(): void {
  const db = getDb();
  db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS ai_messages');
    db.exec('DROP TABLE IF EXISTS ai_conversations');
    db.prepare("DELETE FROM role_permissions WHERE permission_key = 'noleko.agent_prototip'").run();
  })();
  try {
    fs.rmSync(path.join(process.cwd(), 'data', 'ai-agent-workspace'), { recursive: true, force: true });
  } catch { /* folder je zauzet ili ne postoji - nije bitno */ }
}

let schemaReady = false;

export function initAiSchema(): void {
  if (schemaReady) return;
  removeNolekoPrototype();
  schemaReady = true;
}
