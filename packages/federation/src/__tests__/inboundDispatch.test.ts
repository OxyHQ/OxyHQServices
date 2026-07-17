import {
  createInboundDispatcher,
  ActorResolutionPendingError,
  type InboundDispatcherConfig,
  type InboundActivityValidation,
} from '../node/inboundDispatch';

/**
 * Phase 4b inbound dispatch proof.
 *
 * The engine owns Follow / Accept / Undo(Follow) / Reject and hands every content
 * verb to `onContentActivity`. This locks: a signed Follow bridges the Oxy edge +
 * sends Accept; Undo(Follow) unbridges; Accept marks the outbound follow; a
 * Create/Announce/Like/Delete/Update (and a non-follow Undo) route to
 * `onContentActivity`; the consent gate drops an OFF owner's inbound Follow; and a
 * follower actor that has not yet resolved to an Oxy user DEFERS (throws) for
 * retry.
 */

const LOCAL_ACTOR = 'https://mention.earth/ap/users/alice';
const REMOTE_ACTOR = 'https://remote.example/users/bob';

function makeRig(overrides: {
  localUser?: { _id?: string | null; id?: string | null } | null;
  sharingEnabled?: boolean;
  followerOxyUserId?: string | null;
  inboundFollow?: { _id: unknown; localUserId: string } | null;
  actorOxyUserIdForUndo?: string | null;
  validate?: (activity: Record<string, unknown>) => InboundActivityValidation;
} = {}) {
  const bridgeFollowCalls: Array<[string, string]> = [];
  const bridgeUnfollowCalls: Array<[string, string]> = [];
  const acceptsSent: Array<{ localOxyUserId: string; localUsername: string; followActivityId: string; remoteActorUri: string }> = [];
  const inboundAcceptedUpserts: Array<{ localUserId: string; remoteActorUri: string; activityId: string }> = [];
  const deletedFollowIds: unknown[] = [];
  const contentActivities: Array<{ type: unknown; verifiedActorUri: string }> = [];
  const outboundAcceptedByActivityId: Array<[string, string]> = [];
  const outboundAcceptedAnyPending: string[] = [];
  const outboundRejected: Array<[string, string | undefined]> = [];
  const onInboundFollowAcceptedCalls: Array<[string, string, string]> = [];
  const onOutboundFollowAcceptedCalls: string[] = [];

  const config: InboundDispatcherConfig = {
    validateActivity:
      overrides.validate ??
      ((activity) => {
        const type = typeof activity.type === 'string' ? activity.type : undefined;
        return type ? { ok: true, type } : { ok: false, summary: 'no type' };
      }),
    identity: {
      resolveUserByUsername: async () =>
        overrides.localUser === undefined ? { _id: 'u-alice' } : overrides.localUser,
      bridgeFollow: async (follower, local) => {
        bridgeFollowCalls.push([follower, local]);
      },
      bridgeUnfollow: async (follower, local) => {
        bridgeUnfollowCalls.push([follower, local]);
      },
    },
    consent: { isSharingEnabledFromUser: () => overrides.sharingEnabled ?? true },
    actorResolver: {
      getOrFetchActor: async () => ({
        oxyUserId: 'followerOxyUserId' in overrides ? overrides.followerOxyUserId : 'u-bob',
      }),
    },
    follows: {
      upsertInboundAccepted: async (localUserId, remoteActorUri, activityId) => {
        inboundAcceptedUpserts.push({ localUserId, remoteActorUri, activityId });
      },
      findInboundFollow: async () => overrides.inboundFollow ?? null,
      deleteFollowById: async (id) => {
        deletedFollowIds.push(id);
      },
      findActorOxyUserId: async () => overrides.actorOxyUserIdForUndo ?? null,
      markOutboundAcceptedByActivityId: async (uri, activityId) => {
        outboundAcceptedByActivityId.push([uri, activityId]);
        return true;
      },
      markOutboundAcceptedAnyPending: async (uri) => {
        outboundAcceptedAnyPending.push(uri);
        return true;
      },
      markOutboundRejected: async (uri, activityId) => {
        outboundRejected.push([uri, activityId]);
      },
    },
    delivery: {
      sendAccept: async (localOxyUserId, localUsername, followActivityId, remoteActorUri) => {
        acceptsSent.push({ localOxyUserId, localUsername, followActivityId, remoteActorUri });
      },
    },
    onInboundFollowAccepted: async (localUserId, followerOxyUserId, actorUri) => {
      onInboundFollowAcceptedCalls.push([localUserId, followerOxyUserId, actorUri]);
    },
    onOutboundFollowAccepted: async (actorUri) => {
      onOutboundFollowAcceptedCalls.push(actorUri);
    },
    onContentActivity: async (activity, verifiedActorUri) => {
      contentActivities.push({ type: activity.type, verifiedActorUri });
    },
    logger: { debug: () => {}, info: () => {}, warn: () => {} },
  };

  return {
    dispatcher: createInboundDispatcher(config),
    bridgeFollowCalls,
    bridgeUnfollowCalls,
    acceptsSent,
    inboundAcceptedUpserts,
    deletedFollowIds,
    contentActivities,
    outboundAcceptedByActivityId,
    outboundAcceptedAnyPending,
    outboundRejected,
    onInboundFollowAcceptedCalls,
    onOutboundFollowAcceptedCalls,
  };
}

describe('inbound Follow', () => {
  it('bridges the Oxy edge, records the follow, sends Accept, and notifies', async () => {
    const rig = makeRig();
    await rig.dispatcher.processInboxActivity(
      { type: 'Follow', id: 'f1', actor: REMOTE_ACTOR, object: LOCAL_ACTOR },
      REMOTE_ACTOR,
    );

    expect(rig.bridgeFollowCalls).toEqual([['u-bob', 'u-alice']]);
    expect(rig.inboundAcceptedUpserts).toEqual([{ localUserId: 'u-alice', remoteActorUri: REMOTE_ACTOR, activityId: 'f1' }]);
    expect(rig.acceptsSent).toEqual([
      { localOxyUserId: 'u-alice', localUsername: 'alice', followActivityId: 'f1', remoteActorUri: REMOTE_ACTOR },
    ]);
    expect(rig.onInboundFollowAcceptedCalls).toEqual([['u-alice', 'u-bob', REMOTE_ACTOR]]);
  });

  it('drops the Follow (no bridge/accept) when the target has sharing OFF', async () => {
    const rig = makeRig({ sharingEnabled: false });
    await rig.dispatcher.processInboxActivity(
      { type: 'Follow', id: 'f1', actor: REMOTE_ACTOR, object: LOCAL_ACTOR },
      REMOTE_ACTOR,
    );
    expect(rig.bridgeFollowCalls).toHaveLength(0);
    expect(rig.acceptsSent).toHaveLength(0);
  });

  it('defers (throws) when the follower actor has no Oxy user yet — for BullMQ retry', async () => {
    const rig = makeRig({ followerOxyUserId: null });
    await expect(
      rig.dispatcher.processInboxActivity(
        { type: 'Follow', id: 'f1', actor: REMOTE_ACTOR, object: LOCAL_ACTOR },
        REMOTE_ACTOR,
      ),
    ).rejects.toBeInstanceOf(ActorResolutionPendingError);
    expect(rig.bridgeFollowCalls).toHaveLength(0);
  });

  it('ignores a self-follow', async () => {
    const rig = makeRig({ localUser: { _id: 'u-bob' }, followerOxyUserId: 'u-bob' });
    await rig.dispatcher.processInboxActivity(
      { type: 'Follow', id: 'f1', actor: REMOTE_ACTOR, object: LOCAL_ACTOR },
      REMOTE_ACTOR,
    );
    expect(rig.bridgeFollowCalls).toHaveLength(0);
    expect(rig.acceptsSent).toHaveLength(0);
  });

  it('drops a Follow for an unknown local user', async () => {
    const rig = makeRig({ localUser: null });
    await rig.dispatcher.processInboxActivity(
      { type: 'Follow', id: 'f1', actor: REMOTE_ACTOR, object: LOCAL_ACTOR },
      REMOTE_ACTOR,
    );
    expect(rig.bridgeFollowCalls).toHaveLength(0);
  });
});

describe('inbound Undo(Follow)', () => {
  it('unbridges the Oxy edge and deletes the follow row', async () => {
    const rig = makeRig({
      inboundFollow: { _id: 'row1', localUserId: 'u-alice' },
      actorOxyUserIdForUndo: 'u-bob',
    });
    await rig.dispatcher.processInboxActivity(
      { type: 'Undo', actor: REMOTE_ACTOR, object: { type: 'Follow', object: LOCAL_ACTOR } },
      REMOTE_ACTOR,
    );
    expect(rig.bridgeUnfollowCalls).toEqual([['u-bob', 'u-alice']]);
    expect(rig.deletedFollowIds).toEqual(['row1']);
    expect(rig.contentActivities).toHaveLength(0);
  });

  it('is idempotent — no row means already processed (no unbridge)', async () => {
    const rig = makeRig({ inboundFollow: null });
    await rig.dispatcher.processInboxActivity(
      { type: 'Undo', actor: REMOTE_ACTOR, object: { type: 'Follow', object: LOCAL_ACTOR } },
      REMOTE_ACTOR,
    );
    expect(rig.bridgeUnfollowCalls).toHaveLength(0);
    expect(rig.deletedFollowIds).toHaveLength(0);
  });

  it('routes Undo(Like) / Undo(Announce) to onContentActivity', async () => {
    const rig = makeRig();
    await rig.dispatcher.processInboxActivity(
      { type: 'Undo', actor: REMOTE_ACTOR, object: { type: 'Like', object: 'https://x/1' } },
      REMOTE_ACTOR,
    );
    expect(rig.contentActivities).toEqual([{ type: 'Undo', verifiedActorUri: REMOTE_ACTOR }]);
    expect(rig.bridgeUnfollowCalls).toHaveLength(0);
  });
});

describe('inbound Accept / Reject', () => {
  it('marks the outbound follow accepted by activity id + triggers the outbox backfill', async () => {
    const rig = makeRig();
    await rig.dispatcher.processInboxActivity(
      { type: 'Accept', actor: REMOTE_ACTOR, object: { type: 'Follow', id: 'https://mention.earth/ap/users/alice/follows/1' } },
      REMOTE_ACTOR,
    );
    expect(rig.outboundAcceptedByActivityId).toEqual([[REMOTE_ACTOR, 'https://mention.earth/ap/users/alice/follows/1']]);
    expect(rig.onOutboundFollowAcceptedCalls).toEqual([REMOTE_ACTOR]);
  });

  it('marks accepted (string ref, then any-pending fallback)', async () => {
    const rig = makeRig();
    await rig.dispatcher.processInboxActivity(
      { type: 'Accept', actor: REMOTE_ACTOR, object: 'https://mention.earth/ap/users/alice/follows/1' },
      REMOTE_ACTOR,
    );
    expect(rig.outboundAcceptedByActivityId).toEqual([[REMOTE_ACTOR, 'https://mention.earth/ap/users/alice/follows/1']]);
  });

  it('marks the outbound follow rejected on Reject(Follow)', async () => {
    const rig = makeRig();
    await rig.dispatcher.processInboxActivity(
      { type: 'Reject', actor: REMOTE_ACTOR, object: { type: 'Follow', id: 'follow-1' } },
      REMOTE_ACTOR,
    );
    expect(rig.outboundRejected).toEqual([[REMOTE_ACTOR, 'follow-1']]);
  });
});

describe('content verbs → onContentActivity', () => {
  it.each(['Create', 'Announce', 'Like', 'Delete', 'Update'])('routes %s to the app', async (type) => {
    const rig = makeRig();
    await rig.dispatcher.processInboxActivity({ type, actor: REMOTE_ACTOR }, REMOTE_ACTOR);
    expect(rig.contentActivities).toEqual([{ type, verifiedActorUri: REMOTE_ACTOR }]);
    expect(rig.bridgeFollowCalls).toHaveLength(0);
  });

  it('drops a malformed activity without dispatching', async () => {
    const rig = makeRig({ validate: () => ({ ok: false, summary: 'bad shape' }) });
    await rig.dispatcher.processInboxActivity({ type: 'Create' }, REMOTE_ACTOR);
    expect(rig.contentActivities).toHaveLength(0);
  });
});
