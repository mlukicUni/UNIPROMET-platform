import { getDb } from './sqlite';
import { NOLEKO_AI_PLAN_SEED } from './seeds/nolekoAiPlan';

/**
 * ==========================================================================
 * UNIPROMET IT ADMIN - NOLEKO AI: DOKUMENTI (npr. AI razvojni plan)
 * Sadržaj je Markdown. Svaka izmena je nova verzija; važeća je poslednja.
 * Stare verzije se čuvaju i mogu da se vrate (vraćanje je nova verzija).
 * ==========================================================================
 */

/** Dokumenti koji postoje i početni sadržaj */
export const NOLEKO_DOCS: Record<string, { title: string; seed: string }> = {
  razvojni_plan: { title: 'AI razvojni plan', seed: NOLEKO_AI_PLAN_SEED }
};

export const MAX_DOC_LENGTH = 300_000;

export interface DocVersion {
  version: number;
  content: string;
  editedBy: string;
  editedByName: string;
  editedAt: string;
  note: string;
}

export type DocVersionInfo = Omit<DocVersion, 'content'> & { length: number };

let schemaReady = false;

export function initNolekoDocsSchema(): void {
  if (schemaReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS noleko_doc_versions (
      doc_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      edited_by TEXT NOT NULL DEFAULT '',
      edited_by_name TEXT NOT NULL DEFAULT '',
      edited_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (doc_key, version)
    );
  `);
  // Početni sadržaj (samo ako dokument još nema nijednu verziju)
  const has = db.prepare('SELECT 1 FROM noleko_doc_versions WHERE doc_key = ? LIMIT 1');
  const insert = db.prepare(
    'INSERT INTO noleko_doc_versions (doc_key, version, content, edited_by, edited_by_name, edited_at, note) VALUES (?, 1, ?, ?, ?, ?, ?)'
  );
  for (const [key, def] of Object.entries(NOLEKO_DOCS)) {
    if (!has.get(key)) insert.run(key, def.seed, 'system', 'Sistem', new Date().toISOString(), 'Početna verzija iz Word dokumenta');
  }
  schemaReady = true;
}

function mapVersion(r: any): DocVersion {
  return {
    version: r.version,
    content: r.content,
    editedBy: r.edited_by,
    editedByName: r.edited_by_name,
    editedAt: r.edited_at,
    note: r.note
  };
}

export function getCurrent(key: string): DocVersion | null {
  const r = getDb().prepare('SELECT * FROM noleko_doc_versions WHERE doc_key = ? ORDER BY version DESC LIMIT 1').get(key);
  return r ? mapVersion(r) : null;
}

export function getVersion(key: string, version: number): DocVersion | null {
  const r = getDb().prepare('SELECT * FROM noleko_doc_versions WHERE doc_key = ? AND version = ?').get(key, version);
  return r ? mapVersion(r) : null;
}

export function listVersions(key: string): DocVersionInfo[] {
  return (getDb()
    .prepare(`SELECT version, edited_by, edited_by_name, edited_at, note, length(content) AS len
              FROM noleko_doc_versions WHERE doc_key = ? ORDER BY version DESC`)
    .all(key) as any[]).map(r => ({
      version: r.version,
      editedBy: r.edited_by,
      editedByName: r.edited_by_name,
      editedAt: r.edited_at,
      note: r.note,
      length: r.len
    }));
}

/**
 * Čuva novu verziju. baseVersion je verzija od koje je korisnik krenuo sa izmenom;
 * ako je u međuvremenu neko drugi sačuvao noviju, izmena se odbija (sukob).
 */
export function saveVersion(
  key: string,
  content: string,
  baseVersion: number,
  user: { email: string; name: string },
  note: string
): DocVersion {
  const db = getDb();
  return db.transaction(() => {
    const current = getCurrent(key);
    const latest = current ? current.version : 0;
    if (baseVersion !== latest) {
      const who = current?.editedByName || current?.editedBy || 'drugi korisnik';
      const err: any = new Error(`Dokument je u međuvremenu izmenio ${who} (verzija ${latest}). Osvežite stranicu i ponovite izmenu.`);
      err.status = 409;
      throw err;
    }
    if (current && current.content === content) {
      const err: any = new Error('Nema izmena za čuvanje.');
      err.status = 400;
      throw err;
    }
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO noleko_doc_versions (doc_key, version, content, edited_by, edited_by_name, edited_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(key, latest + 1, content, user.email, user.name, now, note);
    return { version: latest + 1, content, editedBy: user.email, editedByName: user.name, editedAt: now, note };
  })();
}
