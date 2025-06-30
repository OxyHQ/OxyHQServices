import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { fetchLinkPreview } from '../utils/linkPreview';

const router = Router();

router.get('/preview', async (req: Request, res: Response) => {
  const schema = z.object({ url: z.string().url('Invalid URL') });
  const parseResult = schema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.issues[0].message });
  }
  const { url } = parseResult.data;
  try {
    const preview = await fetchLinkPreview(url);
    return res.json(preview);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to extract metadata' });
  }
});

export default router; 