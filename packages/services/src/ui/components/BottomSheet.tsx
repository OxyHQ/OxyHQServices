import { forwardRef } from 'react';
import {
    BottomSheet as BloomBottomSheet,
    type BottomSheetProps as BloomBottomSheetProps,
    type BottomSheetRef,
} from '@oxyhq/bloom/bottom-sheet';

/**
 * Thin wrapper around `@oxyhq/bloom`'s `BottomSheet` (>=0.4.0).
 *
 * Bloom is the canonical bottom-sheet primitive for the Oxy ecosystem; this
 * wrapper exists only to inject service-specific defaults so the 29+ screens
 * mounted by `BottomSheetRouter` keep the exact UX they had under the
 * pre-refactor in-tree implementation:
 *
 *   - `manualActivation: true` — the body pan uses RNGH's manualActivation
 *     with scroll-handoff, the only RNGH 2.x pattern that doesn't steal
 *     vertical events from inner scrollers on Android. The previous in-tree
 *     implementation always ran in this mode.
 *   - `dynamicBackdrop: true` — backdrop dims proportionally with drag
 *     distance (iOS Photos style). The previous in-tree implementation
 *     always did this.
 *
 * Consumers (`BottomSheetRouter`, primarily) can still override either default
 * by passing the prop explicitly — for example, per-route via `getSheetConfig`.
 *
 * Public API (name + ref shape) is identical to the previous in-tree
 * implementation, so external consumers and `BottomSheetRouter` need no
 * changes beyond the new pass-through props.
 */
export type BottomSheetProps = BloomBottomSheetProps;
export type { BottomSheetRef };

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>((props, ref) => {
    const { manualActivation = true, dynamicBackdrop = true, ...rest } = props;
    return (
        <BloomBottomSheet
            ref={ref}
            manualActivation={manualActivation}
            dynamicBackdrop={dynamicBackdrop}
            {...rest}
        />
    );
});

BottomSheet.displayName = 'BottomSheet';

export default BottomSheet;
