import { Router, Request, Response } from 'express';
import {
  ownerKey,
  listConversations,
  getConversation,
  createConversation,
  deleteConversation,
  listMessages,
  hasAgentReply,
  renewSessionId,
  addMessage
} from '../db/aiAgentDb';
import {
  getAgentStatus,
  checkLimits,
  runAgent,
  isAllowedModel,
  defaultModel,
  isAllowedEffort,
  defaultEffort,
  MAX_PROMPT_LENGTH
} from '../services/aiAgentService';
import { addServerLog } from './system.routes';

/**
 * NOLEKO AI - agent prototip (chat preko Claude Code CLI).
 * Montirano na /api/ai-agent; routeAccess traži pregled stranice 'noleko.agent_prototip'.
 * Svaki korisnik vidi i briše isključivo svoje razgovore.
 */
export const aiAgentRouter = Router();

function fail(res: Response, err: any, status = 400) {
  res.status(status).json({ success: false, error: err?.message || String(err) });
}

function owner(req: Request): string {
  const key = req.sessionUser ? ownerKey(req.sessionUser) : '';
  if (!key) throw new Error('Korisnik nije prepoznat.');
  return key;
}

aiAgentRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, status: await getAgentStatus(), maxPromptLength: MAX_PROMPT_LENGTH });
  } catch (err) {
    fail(res, err, 500);
  }
});

aiAgentRouter.get('/conversations', (req: Request, res: Response) => {
  try {
    res.json({ success: true, conversations: listConversations(owner(req)) });
  } catch (err) {
    fail(res, err);
  }
});

aiAgentRouter.get('/conversations/:id', (req: Request, res: Response) => {
  try {
    const conv = getConversation(owner(req), req.params.id);
    if (!conv) return fail(res, new Error('Razgovor nije pronađen.'), 404);
    res.json({ success: true, conversation: conv, messages: listMessages(conv.id) });
  } catch (err) {
    fail(res, err);
  }
});

aiAgentRouter.delete('/conversations/:id', (req: Request, res: Response) => {
  try {
    if (!deleteConversation(owner(req), req.params.id)) return fail(res, new Error('Razgovor nije pronađen.'), 404);
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * POST /api/ai-agent/chat { conversationId?, prompt, model?, effort? }
 * Odgovor je tok događaja (text/event-stream): conversation, model, delta, done, error.
 * Zatvaranje veze (dugme Stop) prekida rad agenta.
 */
aiAgentRouter.post('/chat', async (req: Request, res: Response) => {
  let key: string;
  try {
    key = owner(req);
  } catch (err) {
    return fail(res, err, 401);
  }

  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return fail(res, new Error('Upit ne sme biti prazan.'));
  if (prompt.length > MAX_PROMPT_LENGTH) return fail(res, new Error(`Upit je duži od ${MAX_PROMPT_LENGTH} karaktera.`));
  const requestedModel = req.body?.model;
  if (requestedModel !== undefined && !isAllowedModel(requestedModel)) return fail(res, new Error('Izabrani model nije dozvoljen.'));
  const model = isAllowedModel(requestedModel) ? requestedModel : defaultModel();
  const requestedEffort = req.body?.effort;
  if (requestedEffort !== undefined && !isAllowedEffort(requestedEffort)) return fail(res, new Error('Izabrani nivo truda nije dozvoljen.'));
  const effort = isAllowedEffort(requestedEffort) ? requestedEffort : defaultEffort();

  const status = await getAgentStatus();
  if (!status.ready) return fail(res, new Error(status.message), 503);
  const limitError = checkLimits(key);
  if (limitError) return fail(res, new Error(limitError), 429);

  let conv = null;
  if (req.body?.conversationId) {
    conv = getConversation(key, String(req.body.conversationId));
    if (!conv) return fail(res, new Error('Razgovor nije pronađen.'), 404);
  } else {
    conv = createConversation(key, prompt);
  }

  // Claude sesija postoji tek posle prvog uspešnog odgovora; do tada svaki pokušaj kreće novu
  const resume = hasAgentReply(conv.id);
  const sessionId = resume ? conv.sessionId : renewSessionId(conv.id);
  addMessage(conv.id, 'user', prompt);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('conversation', { id: conv.id, title: conv.title });

  let handle;
  try {
    handle = runAgent(key, prompt, sessionId, resume, model, effort, {
      onDelta: text => send('delta', { text }),
      onModel: model => send('model', { model })
    });
  } catch (err: any) {
    addMessage(conv.id, 'agent', '', 'error');
    send('error', { error: err?.message || String(err) });
    return res.end();
  }

  res.on('close', () => handle.stop());

  const result = await handle.promise;
  const who = req.sessionUser?.email || key;
  if (result.status === 'ok') {
    addMessage(conv.id, 'agent', result.text, 'ok', result.durationMs, result.model, effort, result.context);
    addServerLog('info', `AI agent: odgovor za ${who} (${(result.durationMs / 1000).toFixed(1)} s)`, 'NOLEKO AI');
    send('done', { text: result.text, durationMs: result.durationMs, model: result.model, effort, context: result.context });
  } else if (result.status === 'stopped') {
    addMessage(conv.id, 'agent', result.text, 'stopped', result.durationMs, result.model, effort, result.context);
    send('done', { text: result.text, durationMs: result.durationMs, model: result.model, effort, context: result.context, stopped: true });
  } else {
    addMessage(conv.id, 'agent', result.text, 'error', result.durationMs, result.model, effort, result.context);
    addServerLog('error', `AI agent: greška za ${who}: ${result.error}`, 'NOLEKO AI');
    send('error', { error: result.error, text: result.text });
  }
  res.end();
});
