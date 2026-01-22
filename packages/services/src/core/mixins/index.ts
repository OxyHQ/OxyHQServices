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

/**
 * Composes all OxyServices mixins in the correct order
 *
 * Order matters for mixins - dependencies should be applied first.
 * This function ensures consistent composition across the codebase.
 *
 * New cross-domain auth mixins added:
 * - FedCM: Modern browser-native identity federation (Google-style)
 * - Popup: OAuth2-style popup authentication
 * - Redirect: Traditional redirect-based authentication
 *
 * @returns The fully composed OxyServices class with all mixins applied
 */
export function composeOxyServices() {
  return OxyServicesUtilityMixin(
    OxyServicesFeaturesMixin(
      OxyServicesSecurityMixin(
        OxyServicesDevicesMixin(
          OxyServicesAnalyticsMixin(
            OxyServicesLocationMixin(
              OxyServicesDeveloperMixin(
                OxyServicesAssetsMixin(
                  OxyServicesKarmaMixin(
                    OxyServicesPaymentMixin(
                      OxyServicesLanguageMixin(
                        OxyServicesPrivacyMixin(
                          OxyServicesUserMixin(
                            // Cross-domain authentication mixins (web-only)
                            OxyServicesRedirectAuthMixin(
                              OxyServicesPopupAuthMixin(
                                OxyServicesFedCMMixin(
                                  // Base authentication mixin
                                  OxyServicesAuthMixin(OxyServicesBase)
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

