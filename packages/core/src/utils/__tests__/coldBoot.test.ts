import {
  runColdBoot,
  type ColdBootStep,
  type ColdBootStepResult,
} from '../coldBoot';

interface TestSession {
  readonly userId: string;
}

function sessionStep(
  id: string,
  userId: string,
  onRun?: () => void
): ColdBootStep<TestSession> {
  return {
    id,
    run: async (): Promise<ColdBootStepResult<TestSession>> => {
      onRun?.();
      return { kind: 'session', session: { userId } };
    },
  };
}

function skipStep(id: string, onRun?: () => void): ColdBootStep<TestSession> {
  return {
    id,
    run: async (): Promise<ColdBootStepResult<TestSession>> => {
      onRun?.();
      return { kind: 'skip' };
    },
  };
}

describe('runColdBoot', () => {
  it('returns the first session and short-circuits remaining steps', async () => {
    const ranLater = jest.fn();
    const outcome = await runColdBoot<TestSession>({
      steps: [
        skipStep('first'),
        sessionStep('winner', 'u-123'),
        sessionStep('later', 'u-999', ranLater),
      ],
    });

    expect(outcome).toEqual({
      kind: 'session',
      via: 'winner',
      session: { userId: 'u-123' },
    });
    expect(ranLater).not.toHaveBeenCalled();
  });

  it('outcome.via is the winning step id', async () => {
    const outcome = await runColdBoot<TestSession>({
      steps: [skipStep('a'), skipStep('b'), sessionStep('c', 'u-7')],
    });

    expect(outcome.kind).toBe('session');
    if (outcome.kind === 'session') {
      expect(outcome.via).toBe('c');
      expect(outcome.session).toEqual({ userId: 'u-7' });
    }
  });

  it('returns unauthenticated when every step skips', async () => {
    const outcome = await runColdBoot<TestSession>({
      steps: [skipStep('a'), skipStep('b'), skipStep('c')],
    });

    expect(outcome).toEqual({ kind: 'unauthenticated' });
  });

  it('returns unauthenticated for an empty step list', async () => {
    const outcome = await runColdBoot<TestSession>({ steps: [] });
    expect(outcome).toEqual({ kind: 'unauthenticated' });
  });

  it('skips a disabled step WITHOUT calling its run()', async () => {
    const disabledRun = jest.fn();
    const outcome = await runColdBoot<TestSession>({
      steps: [
        {
          id: 'disabled',
          enabled: () => false,
          run: async (): Promise<ColdBootStepResult<TestSession>> => {
            disabledRun();
            return { kind: 'session', session: { userId: 'should-not-run' } };
          },
        },
        sessionStep('enabled', 'u-ok'),
      ],
    });

    expect(disabledRun).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: 'session',
      via: 'enabled',
      session: { userId: 'u-ok' },
    });
  });

  it('runs an enabled:()=>true step', async () => {
    const outcome = await runColdBoot<TestSession>({
      steps: [
        {
          id: 'gated',
          enabled: () => true,
          run: async (): Promise<ColdBootStepResult<TestSession>> => ({
            kind: 'session',
            session: { userId: 'u-gated' },
          }),
        },
      ],
    });

    expect(outcome).toEqual({
      kind: 'session',
      via: 'gated',
      session: { userId: 'u-gated' },
    });
  });

  it('reports a thrown run() via onStepError and continues to the next step', async () => {
    const onStepError = jest.fn();
    const boom = new Error('run exploded');
    const outcome = await runColdBoot<TestSession>({
      steps: [
        {
          id: 'throws',
          run: async (): Promise<ColdBootStepResult<TestSession>> => {
            throw boom;
          },
        },
        sessionStep('recovers', 'u-after-throw'),
      ],
      onStepError,
    });

    expect(onStepError).toHaveBeenCalledTimes(1);
    expect(onStepError).toHaveBeenCalledWith('throws', boom);
    expect(outcome).toEqual({
      kind: 'session',
      via: 'recovers',
      session: { userId: 'u-after-throw' },
    });
  });

  it('treats a thrown enabled() as disabled, reports via onStepError, and continues', async () => {
    const onStepError = jest.fn();
    const enabledThrew = new Error('enabled exploded');
    const guardedRun = jest.fn();
    const outcome = await runColdBoot<TestSession>({
      steps: [
        {
          id: 'enabled-throws',
          enabled: () => {
            throw enabledThrew;
          },
          run: async (): Promise<ColdBootStepResult<TestSession>> => {
            guardedRun();
            return { kind: 'session', session: { userId: 'should-not-run' } };
          },
        },
        sessionStep('next', 'u-next'),
      ],
      onStepError,
    });

    expect(guardedRun).not.toHaveBeenCalled();
    expect(onStepError).toHaveBeenCalledTimes(1);
    expect(onStepError).toHaveBeenCalledWith('enabled-throws', enabledThrew);
    expect(outcome).toEqual({
      kind: 'session',
      via: 'next',
      session: { userId: 'u-next' },
    });
  });

  it('returns unauthenticated when all steps error and reports each', async () => {
    const onStepError = jest.fn();
    const outcome = await runColdBoot<TestSession>({
      steps: [
        {
          id: 'a',
          run: async (): Promise<ColdBootStepResult<TestSession>> => {
            throw new Error('a');
          },
        },
        {
          id: 'b',
          enabled: () => {
            throw new Error('b');
          },
          run: async (): Promise<ColdBootStepResult<TestSession>> => ({
            kind: 'skip',
          }),
        },
      ],
      onStepError,
    });

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(onStepError).toHaveBeenCalledTimes(2);
  });

  it('does not require onStepError to be provided when a step throws', async () => {
    const outcome = await runColdBoot<TestSession>({
      steps: [
        {
          id: 'throws',
          run: async (): Promise<ColdBootStepResult<TestSession>> => {
            throw new Error('no observer');
          },
        },
        sessionStep('ok', 'u-ok'),
      ],
    });

    expect(outcome).toEqual({
      kind: 'session',
      via: 'ok',
      session: { userId: 'u-ok' },
    });
  });
});
