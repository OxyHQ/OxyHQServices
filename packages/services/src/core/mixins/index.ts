/**
 * Centralized mixin exports and composition helper
 * 
 * This module provides a clean way to compose all mixins
 * and ensures consistent ordering for better maintainability
 */

import { OxyServicesBase } from '../OxyServices.base';
import { OxyServicesAuthMixin } from './OxyServices.auth';
import { OxyServicesUserMixin } from './OxyServices.user';
import { OxyServicesTotpMixin } from './OxyServices.totp';
import { OxyServicesPrivacyMixin } from './OxyServices.privacy';
import { OxyServicesLanguageMixin } from './OxyServices.language';
import { OxyServicesPaymentMixin } from './OxyServices.payment';
import { OxyServicesKarmaMixin } from './OxyServices.karma';
import { OxyServicesAssetsMixin } from './OxyServices.assets';
import { OxyServicesDeveloperMixin } from './OxyServices.developer';
import { OxyServicesLocationMixin } from './OxyServices.location';
import { OxyServicesAnalyticsMixin } from './OxyServices.analytics';
import { OxyServicesDevicesMixin } from './OxyServices.devices';
import { OxyServicesUtilityMixin } from './OxyServices.utility';

/**
 * Composes all OxyServices mixins in the correct order
 * 
 * Order matters for mixins - dependencies should be applied first.
 * This function ensures consistent composition across the codebase.
 * 
 * @returns The fully composed OxyServices class with all mixins applied
 */
export function composeOxyServices() {
  return OxyServicesUtilityMixin(
    OxyServicesDevicesMixin(
      OxyServicesAnalyticsMixin(
        OxyServicesLocationMixin(
          OxyServicesDeveloperMixin(
            OxyServicesAssetsMixin(
              OxyServicesKarmaMixin(
                OxyServicesPaymentMixin(
                  OxyServicesLanguageMixin(
                    OxyServicesPrivacyMixin(
                      OxyServicesTotpMixin(
                        OxyServicesUserMixin(
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
  );
}

