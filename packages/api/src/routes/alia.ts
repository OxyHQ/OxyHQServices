import { Router, Request, Response } from 'express';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const ALIA_BASE_URL = 'https://api.alia.onl/v1';
const ALIA_API_KEY = process.env.ALIA_API_KEY;

/**
 * POST /api/alia/chat/completions
 * Proxies chat completion requests to the Alia API.
 * Supports both streaming (SSE) and non-streaming responses.
 */
router.post('/chat/completions', authMiddleware, async (req: Request, res: Response) => {
  const apiKey = ALIA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ALIA_API_KEY not configured on server' });
    return;
  }

  const isStreaming = req.body.stream === true;

  try {
    const response = await axios.post(`${ALIA_BASE_URL}/chat/completions`, req.body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      responseType: isStreaming ? 'stream' : 'json',
    });

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.data.pipe(res);
    } else {
      res.json(response.data);
    }
  } catch (err: any) {
    const status = err.response?.status ?? 502;
    const message = err.response?.data ?? 'Failed to reach Alia API';
    res.status(status).json({ error: 'ALIA_PROXY_ERROR', message });
  }
});

export default router;
