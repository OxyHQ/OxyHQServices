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

  describe('result-bearing sub-flow (morphed-in avatar picker)', () => {
    it('resolves with the descendant dismiss result and pops back to the caller frame', async () => {
      const stack = createSurfaceNavStack('EditProfile');
      const flow = stack.beginFlow('ChangeAvatar');
      expect(stack.getTop().route).toBe('ChangeAvatar');
      // Drill into the crop editor within the flow, then confirm.
      stack.navigate('AvatarCrop', { imageUri: 'file:///x.jpg' });
      stack.resolveFlowOrDismiss({ uri: 'file:///cropped.jpg' });
      await expect(flow).resolves.toEqual({ uri: 'file:///cropped.jpg' });
      // Popped back to the frame that started the flow — surface NOT dismissed.
      expect(stack.getTop().route).toBe('EditProfile');
      expect(stack.store.getState().closing).toBe(false);
    });

    it('resolves undefined when the flow entry frame is backed out of', async () => {
      const stack = createSurfaceNavStack('EditProfile');
      const flow = stack.beginFlow('ChangeAvatar');
      stack.navigate('AvatarCrop');
      expect(stack.goBack()).toBe(true); // crop -> list (still in flow)
      expect(stack.goBack()).toBe(true); // list -> EditProfile (cancels flow)
      await expect(flow).resolves.toBeUndefined();
      expect(stack.getTop().route).toBe('EditProfile');
      expect(stack.store.getState().closing).toBe(false);
    });

    it('resolveFlowOrDismiss with NO active flow dismisses the surface (cold present)', () => {
      const stack = createSurfaceNavStack('ChangeAvatar');
      stack.resolveFlowOrDismiss({ removed: true });
      expect(stack.store.getState().closing).toBe(true);
      expect(stack.store.getState().closeResult).toEqual({ removed: true });
    });

    it('abandons a pending flow (undefined) when the surface is torn down', async () => {
      const stack = createSurfaceNavStack('EditProfile');
      const flow = stack.beginFlow('ChangeAvatar');
      stack.abandonActiveFlow();
      await expect(flow).resolves.toBeUndefined();
    });

    it('NESTS flows: the inner selector resolves first, then the outer avatar flow', async () => {
      // ChangeAvatar (outer) → "My Oxy files" FileManagement (inner) → back → crop.
      const stack = createSurfaceNavStack('EditProfile');
      const avatarFlow = stack.beginFlow('ChangeAvatar');
      const fileFlow = stack.beginFlow('FileManagement');
      expect(stack.getTop().route).toBe('FileManagement');
      // Pick a file → inner flow resolves, pops back to ChangeAvatar (outer still open).
      stack.resolveFlowOrDismiss({ id: 'file-1' });
      await expect(fileFlow).resolves.toEqual({ id: 'file-1' });
      expect(stack.getTop().route).toBe('ChangeAvatar');
      expect(stack.store.getState().closing).toBe(false);
      // Now drill to crop and confirm → outer flow resolves, pops to EditProfile.
      stack.navigate('AvatarCrop');
      stack.resolveFlowOrDismiss({ uri: 'file:///c.jpg' });
      await expect(avatarFlow).resolves.toEqual({ uri: 'file:///c.jpg' });
      expect(stack.getTop().route).toBe('EditProfile');
    });

    it('cancelling the inner selector returns to the outer flow, leaving it open', async () => {
      const stack = createSurfaceNavStack('EditProfile');
      const avatarFlow = stack.beginFlow('ChangeAvatar');
      const fileFlow = stack.beginFlow('FileManagement');
      expect(stack.goBack()).toBe(true); // FileManagement -> ChangeAvatar (cancels inner)
      await expect(fileFlow).resolves.toBeUndefined();
      expect(stack.getTop().route).toBe('ChangeAvatar');
      // The outer avatar flow is still pending.
      let outerSettled = false;
      void avatarFlow.then(() => { outerSettled = true; });
      await Promise.resolve();
      expect(outerSettled).toBe(false);
    });

    it('tearing down the surface abandons ALL nested flows (undefined)', async () => {
      const stack = createSurfaceNavStack('EditProfile');
      const outer = stack.beginFlow('ChangeAvatar');
      const inner = stack.beginFlow('FileManagement');
      stack.abandonActiveFlow();
      await expect(inner).resolves.toBeUndefined();
      await expect(outer).resolves.toBeUndefined();
    });
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
