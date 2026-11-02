import { Router, Request, Response } from 'express';
import { NOLEKO_DOCS, MAX_DOC_LENGTH, getCurrent, getVersion, listVersions, saveVersion } from '../db/nolekoDocsDb';
import { addServerLog } from './system.routes';

/**
 * NOLEKO AI - dokumenti (AI razvojni plan) sa istorijom verzija.
 * Montirano na /api/noleko/docs; routeAccess traži pregled stranice za čitanje i izmenu za čuvanje.
 */
export const nolekoDocsRouter = Router();

function fail(res: Response, err: any, status = 400) {
  res.status(err?.status || status).json({ success: false, error: err?.message || String(err) });
}

function docKey(req: Request, res: Response): string | null {
  const key = req.params.key;
  if (!NOLEKO_DOCS[key]) {
    fail(res, new Error('Dokument ne postoji.'), 404);
    return null;
  }
  return key;
}

nolekoDocsRouter.get('/:key', (req: Request, res: Response) => {
  const key = docKey(req, res);
  if (!key) return;
  const doc = getCurrent(key);
  if (!doc) return fail(res, new Error('Dokument još nema sadržaj.'), 404);
  res.json({ success: true, title: NOLEKO_DOCS[key].title, document: doc, maxLength: MAX_DOC_LENGTH });
});

nolekoDocsRouter.get('/:key/versions', (req: Request, res: Response) => {
  const key = docKey(req, res);
  if (!key) return;
  res.json({ success: true, versions: listVersions(key) });
});

nolekoDocsRouter.get('/:key/versions/:version', (req: Request, res: Response) => {
  const key = docKey(req, res);
  if (!key) return;
  const doc = getVersion(key, Number(req.params.version));
  if (!doc) return fail(res, new Error('Verzija ne postoji.'), 404);
  res.json({ success: true, document: doc });
});

/** PUT /api/noleko/docs/:key { content, baseVersion, note? } */
nolekoDocsRouter.put('/:key', (req: Request, res: Response) => {
  const key = docKey(req, res);
  if (!key) return;
  const content = typeof req.body?.content === 'string' ? req.body.content.replace(/\r\n/g, '\n') : '';
  const baseVersion = Number(req.body?.baseVersion);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
  if (!content.trim()) return fail(res, new Error('Dokument ne sme biti prazan.'));
  if (content.length > MAX_DOC_LENGTH) return fail(res, new Error(`Dokument je duži od ${MAX_DOC_LENGTH} karaktera.`));
  if (!Number.isInteger(baseVersion) || baseVersion < 0) return fail(res, new Error('Nedostaje verzija od koje je izmena krenula.'));

  const user = req.sessionUser;
  try {
    const doc = saveVersion(key, content, baseVersion, { email: user?.email || user?.id || '', name: user?.name || '' }, note);
    addServerLog('info', `NOLEKO AI: ${NOLEKO_DOCS[key].title} sačuvan kao verzija ${doc.version} (${user?.email || '?'})`, 'NOLEKO AI');
    res.json({ success: true, document: doc });
  } catch (err) {
    fail(res, err);
  }
});
