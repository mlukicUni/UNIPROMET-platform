import crypto from 'crypto';
import { getDb } from './sqlite';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - NOLEKO AI: AGENT PROTOTIP (razgovori i poruke)
 * Svaki korisnik vidi isključivo svoje razgovore.
 * Vlasnik je ključ korisnika (email/UPN malim slovima, inače ID sesije).
 * ==========================================================================
 */

export const MAX_CONVERSATIONS = 200;

export interface AiConversation {
  id: string;
  title: string;
  sessionId: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: number;
  role: 'user' | 'agent';
  content: string;
  status: 'ok' | 'error' | 'stopped';
  durationMs: number | null;
  model: string;
  effort: string;
  contextTokens: number | null;
  contextWindow: number | null;
  createdAt: string;
}

let schemaReady = false;

export function initAiAgentSchema(): void {
  if (schemaReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      title TEXT NOT NULL,
      session_id TEXT NOT NULL,
      model TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner ON ai_conversations(owner, updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, id);
  `);
  // Model i nivo truda kojim je odgovoreno (izbor po poruci)
  const cols = getDb().prepare('PRAGMA table_info(ai_messages)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'model')) getDb().exec("ALTER TABLE ai_messages ADD COLUMN model TEXT DEFAULT ''");
  if (!cols.some(c => c.name === 'effort')) getDb().exec("ALTER TABLE ai_messages ADD COLUMN effort TEXT DEFAULT ''");
  // Popunjenost konteksta razgovora posle odgovora (tokeni i prozor modela)
  if (!cols.some(c => c.name === 'context_tokens')) getDb().exec('ALTER TABLE ai_messages ADD COLUMN context_tokens INTEGER');
  if (!cols.some(c => c.name === 'context_window')) getDb().exec('ALTER TABLE ai_messages ADD COLUMN context_window INTEGER');
  schemaReady = true;
}

/** Ključ vlasnika razgovora */
export function ownerKey(user: { id?: string; email?: string }): string {
  const email = (user.email || '').trim().toLowerCase();
  return email || (user.id || '').trim();
}

function mapConversation(r: any): AiConversation {
  return {
    id: r.id,
    title: r.title,
    sessionId: r.session_id,
    model: r.model || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function listConversations(owner: string): AiConversation[] {
  return (getDb()
    .prepare('SELECT * FROM ai_conversations WHERE owner = ? ORDER BY updated_at DESC LIMIT ?')
    .all(owner, MAX_CONVERSATIONS) as any[]).map(mapConversation);
}

export function getConversation(owner: string, id: string): AiConversation | null {
  const r = getDb().prepare('SELECT * FROM ai_conversations WHERE id = ? AND owner = ?').get(id, owner);
  return r ? mapConversation(r) : null;
}

/** Novi razgovor; ID Claude sesije se zadaje odmah da bi naredne poruke nastavile isti razgovor */
export function createConversation(owner: string, firstPrompt: string): AiConversation {
  const now = new Date().toISOString();
  const id = `ai-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const oneLine = firstPrompt.replace(/\s+/g, ' ').trim();
  const title = oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine || 'Novi razgovor';
  const sessionId = crypto.randomUUID();
  getDb()
    .prepare('INSERT INTO ai_conversations (id, owner, title, session_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, title, sessionId, '', now, now);
  return { id, title, sessionId, model: '', createdAt: now, updatedAt: now };
}

/** Nova Claude sesija za razgovor čiji prvi upit nije uspeo */
export function renewSessionId(id: string): string {
  const sessionId = crypto.randomUUID();
  getDb().prepare('UPDATE ai_conversations SET session_id = ? WHERE id = ?').run(sessionId, id);
  return sessionId;
}

export function deleteConversation(owner: string, id: string): boolean {
  return getDb().prepare('DELETE FROM ai_conversations WHERE id = ? AND owner = ?').run(id, owner).changes > 0;
}

export function listMessages(conversationId: string): AiMessage[] {
  return (getDb()
    .prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id')
    .all(conversationId) as any[]).map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      status: r.status,
      durationMs: r.duration_ms,
      model: r.model || '',
      effort: r.effort || '',
      contextTokens: r.context_tokens ?? null,
      contextWindow: r.context_window ?? null,
      createdAt: r.created_at
    }));
}

/** Da li je Claude sesija razgovora već započeta (postoji bar jedan uspešan odgovor) */
export function hasAgentReply(conversationId: string): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM ai_messages WHERE conversation_id = ? AND role = 'agent' AND status = 'ok' LIMIT 1")
    .get(conversationId);
}

export function addMessage(
  conversationId: string,
  role: 'user' | 'agent',
  content: string,
  status: 'ok' | 'error' | 'stopped' = 'ok',
  durationMs: number | null = null,
  model = '',
  effort = '',
  context: { tokens: number; window: number } | null = null
): void {
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(`INSERT INTO ai_messages (conversation_id, role, content, status, duration_ms, model, effort, context_tokens, context_window, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(conversationId, role, content, status, durationMs, model, effort, context?.tokens ?? null, context?.window ?? null, now);
  if (model) {
    db.prepare('UPDATE ai_conversations SET updated_at = ?, model = ? WHERE id = ?').run(now, model, conversationId);
  } else {
    db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
  }
}
