/**
 * Centralized mixin exports and composition helper
 *
 * This module provides a clean way to compose all mixins
 * and ensures consistent ordering for better maintainability
 */

import { OxyServicesBase } from '../OxyServices.base';
import { OxyServicesAuthMixin } from './OxyServices.auth';
import { OxyServicesFedCMMixin } from './OxyServices.fedcm';
import { OxyServicesPopupAuthMixin } from './OxyServices.popup';
import { OxyServicesRedirectAuthMixin } from './OxyServices.redirect';
import { OxyServicesUserMixin } from './OxyServices.user';
import { OxyServicesPrivacyMixin } from './OxyServices.privacy';
import { OxyServicesLanguageMixin } from './OxyServices.language';
import { OxyServicesPaymentMixin } from './OxyServices.payment';
import { OxyServicesKarmaMixin } from './OxyServices.karma';
import { OxyServicesAssetsMixin } from './OxyServices.assets';
import { OxyServicesDeveloperMixin } from './OxyServices.developer';
import { OxyServicesLocationMixin } from './OxyServices.location';
import { OxyServicesAnalyticsMixin } from './OxyServices.analytics';
import { OxyServicesDevicesMixin } from './OxyServices.devices';
import { OxyServicesSecurityMixin } from './OxyServices.security';
import { OxyServicesUtilityMixin } from './OxyServices.utility';
import { OxyServicesFeaturesMixin } from './OxyServices.features';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MixinFunction = (Base: any) => any;

/**
 * Mixin pipeline - applied in order from first to last.
 *
 * Order matters for dependencies:
 * 1. Base auth mixin first (required by all others)
 * 2. Cross-domain auth mixins (FedCM, Popup, Redirect)
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
    // - Popup: OAuth2-style popup authentication
    // - Redirect: Traditional redirect-based authentication
    OxyServicesFedCMMixin,
    OxyServicesPopupAuthMixin,
    OxyServicesRedirectAuthMixin,

    // User management (requires auth)
    OxyServicesUserMixin,
    OxyServicesPrivacyMixin,

    // Feature mixins
    OxyServicesLanguageMixin,
    OxyServicesPaymentMixin,
    OxyServicesKarmaMixin,
    OxyServicesAssetsMixin,
    OxyServicesDeveloperMixin,
    OxyServicesLocationMixin,
    OxyServicesAnalyticsMixin,
    OxyServicesDevicesMixin,
    OxyServicesSecurityMixin,
    OxyServicesFeaturesMixin,

    // Utility (last, can use all above)
    OxyServicesUtilityMixin,
];

/**
 * Composes all OxyServices mixins using a pipeline pattern.
 *
 * This is equivalent to the nested calls but more readable and maintainable.
 * Adding a new mixin: just add it to MIXIN_PIPELINE at the appropriate position.
 *
 * @returns The fully composed OxyServices class with all mixins applied
 */
export function composeOxyServices() {
    return MIXIN_PIPELINE.reduce(
        (Base, mixin) => mixin(Base),
        OxyServicesBase as unknown as ReturnType<MixinFunction>
    );
}

// Export the pipeline for testing/debugging
export { MIXIN_PIPELINE };

