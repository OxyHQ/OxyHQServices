/**
 * Config plugin for react-native-hce (which ships no plugin of its own) plus
 * the NDEF tap deep link:
 *  - android.permission.NFC + android.hardware.nfc.hce (not required — the app
 *    must install on NFC-less devices; the emitter hook degrades to 'unsupported')
 *  - the HCE CardService (starts DISABLED; react-native-hce toggles it at runtime)
 *  - res/xml/aid_list.xml with the standard NDEF Type 4 AID (D2760000850101)
 *  - NDEF_DISCOVERED intent filter on MainActivity for oxycommons://attest so a
 *    tap opens the scan/attest flow even when the app is closed
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const AID_LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:requireDeviceUnlock="false">
    <aid-group android:category="other" android:description="@string/app_name">
        <aid-filter android:name="D2760000850101" />
    </aid-group>
</host-apdu-service>
`;

function withHce(config) {
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const resXmlDir = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(resXmlDir, { recursive: true });
      fs.writeFileSync(path.join(resXmlDir, 'aid_list.xml'), AID_LIST_XML);
      return modConfig;
    },
  ]);

  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    if (!manifest['uses-permission'].some((p) => p.$['android:name'] === 'android.permission.NFC')) {
      manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.NFC' } });
    }

    manifest['uses-feature'] = manifest['uses-feature'] ?? [];
    if (!manifest['uses-feature'].some((f) => f.$['android:name'] === 'android.hardware.nfc.hce')) {
      manifest['uses-feature'].push({ $: { 'android:name': 'android.hardware.nfc.hce', 'android:required': 'false' } });
    }

    const app = manifest.application?.[0];
    if (!app) throw new Error('with-hce: AndroidManifest has no <application>');

    app.service = app.service ?? [];
    if (!app.service.some((s) => s.$['android:name'] === 'com.reactnativehce.services.CardService')) {
      app.service.push({
        $: {
          'android:name': 'com.reactnativehce.services.CardService',
          'android:exported': 'true',
          'android:enabled': 'false',
          'android:permission': 'android.permission.BIND_NFC_SERVICE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.nfc.cardemulation.action.HOST_APDU_SERVICE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.nfc.cardemulation.host_apdu_service',
              'android:resource': '@xml/aid_list',
            },
          },
        ],
      });
    }

    const mainActivity = (app.activity ?? []).find((a) => a.$['android:name'] === '.MainActivity');
    if (mainActivity) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'] ?? [];
      const hasNdef = mainActivity['intent-filter'].some((f) =>
        (f.action ?? []).some((a) => a.$['android:name'] === 'android.nfc.action.NDEF_DISCOVERED'),
      );
      if (!hasNdef) {
        mainActivity['intent-filter'].push({
          action: [{ $: { 'android:name': 'android.nfc.action.NDEF_DISCOVERED' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:scheme': 'oxycommons', 'android:host': 'attest' } }],
        });
      }
    }

    return modConfig;
  });

  return config;
}

module.exports = withHce;
