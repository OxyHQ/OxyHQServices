// Canonical pre-bundle strip for device-join return URLs.
// Canonical sync capture — keep in sync with readPendingDeviceJoinCredential (packages/core/src/utils/deviceJoin.ts).
(function () {
  try {
    var l = location;
    if (!l.hash) return;
    var p = new URLSearchParams(l.hash.charAt(0) === '#' ? l.hash.slice(1) : l.hash);
    var d = p.get('oxy_device');
    var s = p.get('device_secret');
    if (!d || !s) return;
    sessionStorage.setItem('oxy.device_join_pending', JSON.stringify({ deviceId: d, deviceSecret: s }));
    history.replaceState(history.state, '', l.pathname + l.search);
  } catch (e) {}
})();
