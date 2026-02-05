/**
 * Index route - redirects to /inbox by default.
 */

import { Redirect } from 'expo-router';

export default function InboxIndex() {
  return <Redirect href="/inbox" />;
}
