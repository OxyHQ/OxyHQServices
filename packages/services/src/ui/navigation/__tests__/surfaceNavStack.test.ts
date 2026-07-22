import { createSurfaceNavStack } from '../surfaceNavStack';
import { __resetSurfaceBackBridgeForTests, pushSurfaceBackHandler, __invokeTopSurfaceBackForTests } from '../surfaceBackBridge';

describe('createSurfaceNavStack', () => {
  it('starts with a single root frame', () => {
    const stack = createSurfaceNavStack('ManageAccount', { foo: 1 });
    expect(stack.getTop().route).toBe('ManageAccount');
    expect(stack.getTop().props).toEqual({ foo: 1 });
    expect(stack.canGoBack()).toBe(false);
  });

  it('navigate pushes frames and goBack pops them', () => {
    const stack = createSurfaceNavStack('ManageAccount');
    stack.navigate('EditProfile', { userId: 'u1' });
    expect(stack.getTop().route).toBe('EditProfile');
    expect(stack.canGoBack()).toBe(true);
    expect(stack.goBack()).toBe(true);
    expect(stack.getTop().route).toBe('ManageAccount');
    expect(stack.goBack()).toBe(false);
  });

  it('replace swaps the top frame without growing history', () => {
    const stack = createSurfaceNavStack('ManageAccount');
    stack.navigate('EditProfile');
    stack.replace('PrivacySettings');
    expect(stack.getTop().route).toBe('PrivacySettings');
    expect(stack.goBack()).toBe(true);
    expect(stack.getTop().route).toBe('ManageAccount');
  });

  it('tracks wizard steps on the current frame', () => {
    const stack = createSurfaceNavStack('EditProfile', { initialStep: 2 });
    expect(stack.getTop().step).toBe(2);
    expect(stack.canGoBack()).toBe(true);
    stack.setStep(1);
    expect(stack.getTop().step).toBe(1);
  });

  it('requestDismiss flips closing once', () => {
    const stack = createSurfaceNavStack('ManageAccount');
    stack.requestDismiss('done');
    expect(stack.store.getState().closing).toBe(true);
    expect(stack.store.getState().closeResult).toBe('done');
    stack.requestDismiss('again');
    expect(stack.store.getState().closeResult).toBe('done');
  });
});

describe('pushSurfaceBackHandler', () => {
  afterEach(() => {
    __resetSurfaceBackBridgeForTests();
  });

  it('delegates to the topmost handler', () => {
    const calls: string[] = [];
    pushSurfaceBackHandler(() => {
      calls.push('bottom');
      return true;
    });
    pushSurfaceBackHandler(() => {
      calls.push('top');
      return true;
    });

    expect(__invokeTopSurfaceBackForTests()).toBe(true);
    expect(calls).toEqual(['top']);
  });
});
