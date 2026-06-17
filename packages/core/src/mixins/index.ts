/**
 * Centralized mixin exports and composition helper
 *
 * This module provides a clean way to compose all mixins
 * and ensures consistent ordering for better maintainability
 */

import { OxyServicesBase } from '../OxyServices.base';
import { OxyServicesAuthMixin } from './OxyServices.auth';
import { OxyServicesFedCMMixin } from './OxyServices.fedcm';
import { OxyServicesSilentAuthMixin } from './OxyServices.silent';
import { OxyServicesRedirectAuthMixin } from './OxyServices.redirect';
import { OxyServicesSsoMixin } from './OxyServices.sso';
import { OxyServicesUserMixin } from './OxyServices.user';
import { OxyServicesPrivacyMixin } from './OxyServices.privacy';
import { OxyServicesLanguageMixin } from './OxyServices.language';
import { OxyServicesPaymentMixin } from './OxyServices.payment';
import { OxyServicesReputationMixin } from './OxyServices.reputation';
import { OxyServicesAssetsMixin } from './OxyServices.assets';
import { OxyServicesApplicationsMixin } from './OxyServices.applications';
import { OxyServicesWorkspacesMixin } from './OxyServices.workspaces';
import { OxyServicesLocationMixin } from './OxyServices.location';
import { OxyServicesAnalyticsMixin } from './OxyServices.analytics';
import { OxyServicesDevicesMixin } from './OxyServices.devices';
import { OxyServicesSecurityMixin } from './OxyServices.security';
import { OxyServicesUtilityMixin } from './OxyServices.utility';
import { OxyServicesFeaturesMixin } from './OxyServices.features';
import { OxyServicesTopicsMixin } from './OxyServices.topics';
import { OxyServicesManagedAccountsMixin } from './OxyServices.managedAccounts';
import { OxyServicesContactsMixin } from './OxyServices.contacts';
import { OxyServicesAppDataMixin } from './OxyServices.appData';

/**
 * Instance shape of every mixin in the pipeline, intersected. The runtime
 * `composeOxyServices()` produces a class whose instances expose all of
 * these methods; we surface that to TypeScript via this intersection so the
 * `extends` site in `OxyServices.ts` can avoid an `as any` cast.
 *
 * If you add a new mixin to `MIXIN_PIPELINE`, add it here too so its methods
 * are visible without a cast.
 */
type AllMixinInstances =
  & InstanceType<ReturnType<typeof OxyServicesAuthMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesFedCMMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesSilentAuthMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesRedirectAuthMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesSsoMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesUserMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesPrivacyMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesLanguageMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesPaymentMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesReputationMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesAssetsMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesApplicationsMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesWorkspacesMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesLocationMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesAnalyticsMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesDevicesMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesSecurityMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesFeaturesMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesTopicsMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesManagedAccountsMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesContactsMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesAppDataMixin<typeof OxyServicesBase>>>
  & InstanceType<ReturnType<typeof OxyServicesUtilityMixin<typeof OxyServicesBase>>>;

/**
 * Constructor type for the fully composed mixin pipeline. Each mixin returns
 * a new constructor that augments its input; reducing across the pipeline
 * yields an instance with every mixin's methods.
 */
export type ComposedOxyServicesConstructor = new (config: import('../OxyServices.base').OxyConfig) => AllMixinInstances;

/**
 * A mixin function: takes a constructor and returns an augmented constructor.
 * Each individual mixin uses a `<T extends typeof OxyServicesBase>` generic
 * to preserve its specific augmentations, but those refinements are
 * intentionally collapsed across the `reduce` call below.
 */
type MixinFunction = (Base: new (...args: unknown[]) => OxyServicesBase) => new (...args: unknown[]) => OxyServicesBase;

/**
 * Mixin pipeline - applied in order from first to last.
 *
 * Order matters for dependencies:
 * 1. Base auth mixin first (required by all others)
 * 2. Cross-domain auth mixins (FedCM, silent iframe, Redirect)
 * 3. User mixin (requires auth)
 * 4. Feature mixins (can depend on user)
 * 5. Utility mixin last (augments all)
 *
 * To add a new mixin: insert it at the appropriate position in this array.
 */
const MIXIN_PIPELINE: MixinFunction[] = [
    // Base authentication
    OxyServicesAuthMixin,

    // Cross-domain authentication (web-only)
    // - FedCM: Modern browser-native identity federation (Google-style)
    // - Silent: iframe-based restore for first-party IdP hosts
    // - Redirect: Traditional redirect-based authentication
    OxyServicesFedCMMixin,
    OxyServicesSilentAuthMixin,
    OxyServicesRedirectAuthMixin,

    // Central cross-domain SSO (opaque-code exchange).
    OxyServicesSsoMixin,

    // User management (requires auth)
    OxyServicesUserMixin,
    OxyServicesPrivacyMixin,

    // Feature mixins
    OxyServicesLanguageMixin,
    OxyServicesPaymentMixin,
    OxyServicesReputationMixin,
    OxyServicesAssetsMixin,
    OxyServicesApplicationsMixin,
    OxyServicesWorkspacesMixin,
    OxyServicesLocationMixin,
    OxyServicesAnalyticsMixin,
    OxyServicesDevicesMixin,
    OxyServicesSecurityMixin,
    OxyServicesFeaturesMixin,
    OxyServicesTopicsMixin,
    OxyServicesManagedAccountsMixin,
    OxyServicesContactsMixin,
    OxyServicesAppDataMixin,

    // Utility (last, can use all above)
    OxyServicesUtilityMixin,
];

/**
 * Composes all OxyServices mixins using a pipeline pattern.
 *
 * This is equivalent to the nested calls but more readable and maintainable.
 * Adding a new mixin: add it to MIXIN_PIPELINE at the appropriate position
 * AND extend `AllMixinInstances` so its methods are visible to consumers.
 *
 * The cast through `unknown` carries the runtime augmentation chain into the
 * static type system. `Array.reduce` cannot track each mixin's generic
 * refinement, so we assert the final shape exposed by all mixins together.
 *
 * @returns The fully composed OxyServices constructor with all mixins applied
 */
export function composeOxyServices(): ComposedOxyServicesConstructor {
    const composed = MIXIN_PIPELINE.reduce(
        (Base, mixin) => mixin(Base),
        OxyServicesBase as unknown as new (...args: unknown[]) => OxyServicesBase
    );
    return composed as unknown as ComposedOxyServicesConstructor;
}

// Export the pipeline for testing/debugging
export { MIXIN_PIPELINE };
