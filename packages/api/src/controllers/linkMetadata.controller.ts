import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';

interface LinkMetadata {
    url: string;
    title: string;
    description: string;
    image?: string;
}

export const fetchLinkMetadata = async (req: Request, res: Response) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // Normalize URL
    let normalizedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        normalizedUrl = 'https://' + url;
    }

    try {
        // Fetch the webpage content
        const response = await axios.get(normalizedUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; OxyHQ/1.0)'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Extract metadata
        const title = $('meta[property="og:title"]').attr('content') ||
                     $('title').text() ||
                     url.replace(/^https?:\/\//, '').replace(/\/$/, '');

        const description = $('meta[property="og:description"]').attr('content') ||
                           $('meta[name="description"]').attr('content') ||
                           `Link to ${url}`;

        const image = $('meta[property="og:image"]').attr('content') ||
                     $('meta[name="twitter:image"]').attr('content') ||
                     $('link[rel="icon"]').attr('href') ||
                     $('link[rel="shortcut icon"]').attr('href');

        // Resolve relative image URLs
        let resolvedImage = image;
        if (image && !image.startsWith('http')) {
            const urlObj = new URL(normalizedUrl);
            resolvedImage = new URL(image, urlObj.origin).href;
        }

        const metadata: LinkMetadata = {
            url: normalizedUrl,
            title: title?.trim() || url,
            description: description?.trim() || 'Link',
            image: resolvedImage
        };

        res.json(metadata);
    } catch (error: any) {
        logger.error('Error fetching link metadata', error instanceof Error ? error : new Error(String(error)));
        
        // Return fallback metadata
        const fallbackUrl = normalizedUrl.startsWith('http') ? normalizedUrl : 'https://' + normalizedUrl;
        res.json({
            url: fallbackUrl,
            title: normalizedUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
            description: 'Link',
            image: undefined
        });
    }
}; 