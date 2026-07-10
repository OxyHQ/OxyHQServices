import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { linkPreviewService } from '../services/linkPreview/linkPreviewService';

interface LinkMetadata {
    url: string;
    title: string;
    description: string;
    image?: string;
}

export const fetchLinkMetadata = async (req: Request, res: Response) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const preview = await linkPreviewService.get(trimmedUrl, { wait: true });
        const metadata: LinkMetadata = {
            url: preview.url,
            title: preview.title?.trim() || preview.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
            description: preview.description?.trim() || 'Link',
            image: preview.image,
        };

        res.json(metadata);
    } catch (error: unknown) {
        logger.error('Error fetching link metadata', error instanceof Error ? error : new Error(String(error)));

        const fallbackUrl = trimmedUrl.startsWith('http') ? trimmedUrl : `https://${trimmedUrl}`;
        res.json({
            url: fallbackUrl,
            title: fallbackUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
            description: 'Link',
            image: undefined,
        });
    }
};
