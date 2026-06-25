describe('aiLabelingService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('keeps AI labeling disabled unless explicitly enabled', async () => {
    delete process.env.AI_LABELING_ENABLED;

    const { AI_LABELING_CONFIG } = await import('../../config/email.config');

    expect(AI_LABELING_CONFIG.enabled).toBe(false);
  });

  it('bounds background classification concurrency and queue size', async () => {
    process.env.ALIA_API_KEY = 'test-alia-key';

    jest.doMock('../../config/email.config', () => ({
      AI_LABELING_CONFIG: {
        enabled: true,
        model: 'alia-lite',
        timeout: 10000,
        maxBodyChars: 1500,
        maxConcurrent: 2,
        maxQueueSize: 4,
      },
    }));

    jest.doMock('../../utils/logger', () => ({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
      },
    }));

    jest.doMock('../../models/Label', () => ({
      Label: {
        find: jest.fn(() => ({
          select: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue([{ name: 'Work' }]),
          })),
        })),
      },
    }));

    jest.doMock('../../models/Message', () => ({
      Message: {
        findOne: jest.fn(() => ({
          select: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue({
              subject: 'Hello',
              from: { name: 'Sender', address: 'sender@example.com' },
              to: [],
              text: 'Body',
            }),
          })),
        })),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
    }));

    const axiosResolvers: Array<(value: unknown) => void> = [];
    const axiosPost = jest.fn(
      () =>
        new Promise((resolve) => {
          axiosResolvers.push(resolve);
        }),
    );
    jest.doMock('axios', () => ({
      __esModule: true,
      default: { post: axiosPost },
    }));

    const { aiLabelingService } = await import('../aiLabeling.service');

    expect(aiLabelingService.enqueueClassification('user-1', 'message-1')).toBe(true);
    expect(aiLabelingService.enqueueClassification('user-1', 'message-2')).toBe(true);
    expect(aiLabelingService.enqueueClassification('user-1', 'message-3')).toBe(true);
    expect(aiLabelingService.enqueueClassification('user-1', 'message-4')).toBe(true);
    expect(aiLabelingService.enqueueClassification('user-1', 'message-5')).toBe(false);

    await Promise.resolve();
    await Promise.resolve();

    expect(axiosPost).toHaveBeenCalledTimes(2);

    axiosResolvers[0]?.({ data: { choices: [{ message: { content: '["Work"]' } }] } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(axiosPost).toHaveBeenCalledTimes(3);
  });
});
