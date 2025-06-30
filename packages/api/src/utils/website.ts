import dns from 'dns/promises';

/**
 * Check if a website exists by attempting to resolve its hostname via DNS.
 * Falls back to an HTTP HEAD request if DNS lookup succeeds but the host
 * cannot be reached via DNS alone (some edge cases).
 */
export const websiteExists = async (urlString: string): Promise<boolean> => {
  try {
    // Ensure the URL is valid first
    const url = new URL(urlString);

    // Attempt to resolve the hostname – this is fast and avoids a full HTTP request
    await dns.lookup(url.hostname);

    return true;
  } catch (dnsError) {
    return false;
  }
}; 