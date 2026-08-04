/**
 * `FollowTargetButton` — one button for everything an Oxy user can follow.
 *
 * Follows a TARGET of any registered kind: a person, a topic, a channel, a
 * store, an artist. Nothing in this file branches on what the target is, which
 * is the property that lets an application this package has never heard of use
 * it without a release.
 *
 * ## Two controls, not one
 *
 * The main press does the obvious thing. The chevron beside it opens the
 * choices that a single press cannot express — follow for a while, stop showing
 * this here without giving it up everywhere — and those belong behind a
 * disclosure precisely because they are not what most people want most of the
 * time. Bloom's `Menu` renders as a bottom sheet on native and a dropdown on
 * web, so this is one component and not a platform fork.
 *
 * ## Verbs
 *
 * "Follow" is wrong for half the things in the ecosystem: you subscribe to a
 * channel, you join a community, you watch a listing. The verb is a prop with a
 * small vocabulary of defaults and a full override, rather than a lookup keyed
 * on kind — a kind→verb table in this package would need a release every time
 * an application invents a kind, which is exactly the coupling #809 removes.
 *
 * ## Relationship to the legacy `FollowButton`
 *
 * `FollowButton` follows a USER through the Mongo-backed social graph and
 * remains the correct component for that until the user graph is migrated onto
 * `/v2/follows`. When it is, that component is deleted and this one takes the
 * name — not aliased, not deprecated in place.
 */

import { memo, useCallback, useMemo } from 'react';
import type { FollowApplicationMode } from '@oxyhq/contracts';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { Button } from '@oxyhq/bloom/button';
import { ChevronBottom_Stroke2_Corner0_Rounded as ChevronDown } from '@oxyhq/bloom/icons';
import { Menu, MenuContent, MenuItem, MenuItemText, MenuTrigger } from '@oxyhq/bloom/menu';
import { toast } from '@oxyhq/bloom/toast';
import { useFollowTarget } from '../hooks/useFollowTarget';

/**
 * The small vocabulary of verbs the ecosystem actually uses. An application
 * whose verb is not here passes `labels` instead — the escape hatch exists so
 * this union never has to grow to accommodate one product's wording.
 */
export type FollowVerb = 'follow' | 'subscribe' | 'join' | 'watch';

export interface FollowLabels {
  /** Not following yet. */
  idle: string;
  /** Following, and this application acts on it. */
  active: string;
  /** Asked, waiting for the other side to accept. */
  pending: string;
  /** Following globally, but switched off in this application. */
  disabled: string;
}

const VERB_LABELS: Record<FollowVerb, FollowLabels> = {
  follow: { idle: 'Follow', active: 'Following', pending: 'Requested', disabled: 'Off here' },
  subscribe: {
    idle: 'Subscribe',
    active: 'Subscribed',
    pending: 'Requested',
    disabled: 'Off here',
  },
  join: { idle: 'Join', active: 'Joined', pending: 'Requested', disabled: 'Off here' },
  watch: { idle: 'Watch', active: 'Watching', pending: 'Requested', disabled: 'Off here' },
};

/** A timed-follow choice offered in the menu. */
export interface FollowDuration {
  label: string;
  seconds: number;
}

const HOUR = 60 * 60;

/**
 * Defaults chosen for the cases a timed follow is actually for: a live event
 * tonight, a story running this week. Not a general-purpose duration picker —
 * an application that needs one passes its own.
 */
const DEFAULT_DURATIONS: FollowDuration[] = [
  { label: '24 hours', seconds: 24 * HOUR },
  { label: '72 hours', seconds: 72 * HOUR },
  { label: 'A week', seconds: 7 * 24 * HOUR },
];

/** One line in the disclosure menu. */
export interface FollowMenuItem {
  key: string;
  label: string;
  /** What the component should call. Named so the table below stays pure. */
  action:
    | { type: 'follow-timed'; seconds: number; durationLabel: string }
    | { type: 'enable-here' }
    | { type: 'disable-here' }
    | { type: 'unfollow' };
}

/**
 * Which choices exist, given the state.
 *
 * Pure and exported because this is the product decision, not a rendering
 * detail: a timed follow is only offered before following, turning it off here
 * is only offered while following, and NEITHER is offered before the server has
 * answered — every one of them addresses a relationship that does not exist
 * yet, so offering them mid-write would mean sending a guessed id.
 */
export function buildFollowMenuItems(input: {
  following: boolean;
  applicationMode: FollowApplicationMode;
  hasRelationship: boolean;
  isPending: boolean;
  durations: FollowDuration[] | false;
  idleVerb: string;
  applicationName: string;
}): FollowMenuItem[] {
  const items: FollowMenuItem[] = [];

  if (!input.following) {
    if (input.durations === false) return items;
    for (const d of input.durations) {
      items.push({
        key: `for-${d.seconds}`,
        label: `${input.idleVerb} for ${d.label.toLowerCase()}`,
        action: { type: 'follow-timed', seconds: d.seconds, durationLabel: d.label },
      });
    }
    return items;
  }

  if (!input.hasRelationship || input.isPending) return items;

  items.push(
    input.applicationMode === 'disabled'
      ? { key: 'enable-here', label: `Show in ${input.applicationName}`, action: { type: 'enable-here' } }
      : {
          key: 'disable-here',
          label: `Don’t show in ${input.applicationName}`,
          action: { type: 'disable-here' },
        }
  );
  items.push({
    // Named for what it does. "Unfollow" beside "don't show here" would read as
    // the same action twice, and the user would pick the wrong one.
    key: 'unfollow-everywhere',
    label: 'Unfollow everywhere',
    action: { type: 'unfollow' },
  });

  return items;
}

export interface FollowTargetButtonProps {
  /** The registered target's id. Registration is separate — see the SDK. */
  targetId: string;
  verb?: FollowVerb;
  /** Full override, for a verb the vocabulary above does not carry. */
  labels?: Partial<FollowLabels>;
  size?: 'small' | 'medium' | 'large';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /**
   * Hide the chevron. For a dense list row where the extra target is more
   * likely to be hit by accident than used on purpose.
   */
  showOptions?: boolean;
  /**
   * Offer timed follows. Pass `false` where a temporary follow makes no sense —
   * a store you buy from, an account you know.
   */
  durations?: FollowDuration[] | false;
  /**
   * This application's name, for the menu line that turns the follow off here.
   * "Don't show in Mention" is a sentence the user can act on; "disable in this
   * application" is not.
   */
  applicationName?: string;
  onChange?: (following: boolean) => void;
}

export const FollowTargetButton = memo(function FollowTargetButton({
  targetId,
  verb = 'follow',
  labels,
  size = 'medium',
  style,
  disabled = false,
  showOptions = true,
  durations = DEFAULT_DURATIONS,
  applicationName,
  onChange,
}: FollowTargetButtonProps) {
  const { status, isFollowing, isUnknown, isPending, follow, unfollow, disableHere, enableHere } =
    useFollowTarget(targetId);

  const text = useMemo(() => ({ ...VERB_LABELS[verb], ...labels }), [verb, labels]);

  const label = useMemo(() => {
    if (status.globalState === 'requested') return text.pending;
    if (!isFollowing) return text.idle;
    // Followed globally but switched off here. `effectiveState` reports
    // `not_following` for this, correctly — the question it answers is "does
    // this act here" — so the label has to be derived from the other two.
    return status.applicationMode === 'disabled' ? text.disabled : text.active;
  }, [isFollowing, status.globalState, status.applicationMode, text]);

  const handlePrimary = useCallback(async () => {
    if (isFollowing) {
      await unfollow();
      onChange?.(false);
      return;
    }
    await follow();
    onChange?.(true);
  }, [isFollowing, follow, unfollow, onChange]);

  const handleTimed = useCallback(
    async (seconds: number, durationLabel: string) => {
      await follow({ expiresIn: seconds });
      onChange?.(true);
      // The confirmation is the point: a follow that ends on its own is a
      // promise, and a user who does not see it made will not believe it.
      toast.success(`Following for ${durationLabel.toLowerCase()}`);
    },
    [follow, onChange]
  );

  const menuItems = useMemo(
    () =>
      buildFollowMenuItems({
        following: isFollowing,
        applicationMode: status.applicationMode,
        hasRelationship: Boolean(status.relationshipId),
        isPending,
        durations,
        idleVerb: text.idle,
        applicationName: applicationName ?? 'this app',
      }),
    [
      isFollowing,
      status.applicationMode,
      status.relationshipId,
      isPending,
      durations,
      text.idle,
      applicationName,
    ]
  );

  const runItem = useCallback(
    (item: FollowMenuItem) => {
      switch (item.action.type) {
        case 'follow-timed':
          void handleTimed(item.action.seconds, item.action.durationLabel);
          return;
        case 'enable-here':
          void enableHere();
          return;
        case 'disable-here':
          void disableHere();
          return;
        case 'unfollow':
          void unfollow();
          onChange?.(false);
      }
    },
    [handleTimed, enableHere, disableHere, unfollow, onChange]
  );

  const primary = (
    <Button
      variant={isFollowing ? 'secondary' : 'primary'}
      size={size}
      // Unknown is not "not following": the button stays inert until the first
      // read settles rather than inviting a follow that may already exist.
      disabled={disabled || isUnknown}
      loading={isPending}
      onPress={() => void handlePrimary()}
      accessibilityLabel={label}
    >
      {label}
    </Button>
  );

  if (!showOptions || menuItems.length === 0) {
    return <View style={style}>{primary}</View>;
  }

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>
      {primary}
      <Menu>
        <MenuTrigger label={`${label} options`} hint="Opens follow options">
          {({ props }) => (
            // The trigger's props are mapped rather than spread: `MenuTrigger`
            // hands back a DOM-ish bag (focus handlers, an accessibility role)
            // and `Button` accepts a different set, so a spread would pass
            // props it silently drops.
            <Button
              variant="secondary"
              size={size === 'large' ? 'large' : 'small'}
              icon={<ChevronDown width={16} />}
              disabled={disabled || isUnknown}
              onPress={props.onPress}
              accessibilityLabel={props.accessibilityLabel}
              accessibilityHint={props.accessibilityHint}
            />
          )}
        </MenuTrigger>
        <MenuContent showCancel>
          {menuItems.map((item) => (
            <MenuItem key={item.key} label={item.label} onPress={() => runItem(item)}>
              <MenuItemText>{item.label}</MenuItemText>
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </View>
  );
});
