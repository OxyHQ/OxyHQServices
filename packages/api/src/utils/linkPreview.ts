import axios from 'axios';
// @ts-ignore – cheerio types may not be installed in all environments
import * as cheerio from 'cheerio';
import * as iconv from 'iconv-lite';
// @ts-ignore – missing types in some envs
import * as chardet from 'chardet';

export interface LinkPreview {
  title: string | null;
  description: string | null;
  image?: string | null;
}

export const fetchLinkPreview = async (url: string): Promise<LinkPreview> => {
  // Fetch as arraybuffer to preserve original bytes
  const resp = await axios.get<ArrayBuffer>(url, { 
    timeout: 8000, 
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'OxyHQ-LinkPreview/1.0' }
  });

  const buffer = Buffer.from(resp.data);
  // Detect charset: use header first then chardet fallback
  let charset: string | undefined;
  const contentType = resp.headers['content-type'];
  if (typeof contentType === 'string') {
    const match = contentType.match(/charset=([^;]+)/i);
    if (match) charset = match[1].trim().toLowerCase();
  }
  if (!charset) {
    charset = chardet.detect(buffer) || 'utf-8';
  }

  // Decode buffer according to charset
  const html = iconv.decode(buffer, charset as any);

  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text() || null;
  const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || null;
  const image = $('meta[property="og:image"]').attr('content') || null;
  return { title, description, image };
}; 