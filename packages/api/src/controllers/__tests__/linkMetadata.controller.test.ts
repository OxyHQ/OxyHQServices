/**
 * The link-metadata endpoint is what a composer / profile editor calls before it
 * stores a link card, so whatever it returns is what gets echoed back into
 * `linksMetadata`. It must never hand a client the raw whitespace of a remote page.
 */
const mockGet = jest.fn();

jest.mock('../../services/linkPreview/linkPreviewService', () => ({
  __esModule: true,
  linkPreviewService: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import type { Request, Response } from 'express';
import { fetchLinkMetadata } from '../linkMetadata.controller';

/** The reported bug: `<title>\n      Mi título\n    </title>`. */
const INDENTED_REMOTE_TITLE = '\n      Mi título — Ejemplo\n    ';

interface CapturedResponse {
  res: Response;
  json: jest.Mock;
  status: jest.Mock;
}

function mockResponse(): CapturedResponse {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { res, json, status };
}

function mockRequest(url: unknown): Request {
  return { body: { url } } as Request;
}

describe('fetchLinkMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('collapses an indented multi-line remote <title> to a single line', async () => {
    mockGet.mockResolvedValue({
      url: 'https://example.com/post',
      title: INDENTED_REMOTE_TITLE,
      description: 'Una   descripción\n  partida',
      image: 'file-id',
    });
    const { res, json } = mockResponse();

    await fetchLinkMetadata(mockRequest('https://example.com/post'), res);

    expect(json).toHaveBeenCalledWith({
      url: 'https://example.com/post',
      title: 'Mi título — Ejemplo',
      description: 'Una descripción partida',
      image: 'file-id',
    });
  });

  it('falls back to the URL when the remote title is whitespace only', async () => {
    mockGet.mockResolvedValue({
      url: 'https://example.com/post',
      title: '  \n  ',
      description: undefined,
      image: undefined,
    });
    const { res, json } = mockResponse();

    await fetchLinkMetadata(mockRequest('https://example.com/post'), res);

    expect(json).toHaveBeenCalledWith({
      url: 'https://example.com/post',
      title: 'example.com/post',
      description: 'Link',
      image: undefined,
    });
  });

  it('rejects a missing URL with a 400', async () => {
    const { res, status } = mockResponse();

    await fetchLinkMetadata(mockRequest(undefined), res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
