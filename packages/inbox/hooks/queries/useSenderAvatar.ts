import { useQuery } from '@tanstack/react-query';
import { md5 } from '@/utils/md5';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';
const EMAIL_DOMAIN = 'oxy.so';

/**
 * Extract username from an @oxy.so email address.
 * Handles plus-aliases: "user+tag@oxy.so" → "user"
 */
function extractOxyUsername(email: string): string | null {
  const [localPart, domain] = email.toLowerCase().split('@');
  if (!localPart || domain !== EMAIL_DOMAIN) return null;
  return localPart.split('+')[0];
}

/**
 * Resolves sender avatar URLs with cascading fallback:
 * 1. Oxy profile avatar (for @oxy.so emails)
 * 2. Gravatar (MD5 hash of email)
 * 3. Domain favicon
 *
 * Returns an ordered list of URLs for the Avatar component to try.
 */
export function useSenderAvatar(email: string) {
  const oxyUsername = extractOxyUsername(email);
  const domain = email.split('@')[1]?.toLowerCase();

  const { data: avatarUrls = [] } = useQuery({
    queryKey: ['sender-avatar', email],
    queryFn: async (): Promise<string[]> => {
      const urls: string[] = [];

      // 1. Oxy user — fetch profile and get avatar file ID
      if (oxyUsername) {
        try {
          const res = await fetch(`${API_URL}/api/profiles/username/${oxyUsername}`);
          if (res.ok) {
            const profile = await res.json();
            if (profile.avatar) {
              urls.push(`${API_URL}/api/assets/${profile.avatar}/stream`);
            }
          }
        } catch {
          // Profile lookup failed — continue to fallbacks
        }
      }

      // 2. Gravatar
      const hash = md5(email.trim().toLowerCase());
      urls.push(`https://www.gravatar.com/avatar/${hash}?d=404&s=80`);

      // 3. Domain favicon
      if (domain) {
        urls.push(`https://${domain}/favicon.ico`);
      }

      return urls;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return { avatarUrls };
}
