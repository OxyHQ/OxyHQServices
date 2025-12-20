/**
 * Authentication flow constants
 */

/**
 * Delays and timeouts
 */
export const STORE_UPDATE_DELAY_MS = 100;
export const USERNAME_DEBOUNCE_MS = 500;
export const CREATING_PROGRESS_INTERVAL_MS = 500;
export const CREATING_FINAL_DELAY_MS = 500;

/**
 * Username validation rules
 */
export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_REGEX = /^[a-z0-9]+$/i;
export const USERNAME_FORMAT_ERROR = 'You can use a-z, 0-9. Minimum length is 4 characters.';
export const USERNAME_INVALID_ERROR = 'Please enter a valid username (4+ characters, a-z and 0-9 only)';

/**
 * Word lists for generating creative usernames
 */
export const USERNAME_ADJECTIVES = [
  'swift', 'bright', 'calm', 'bold', 'keen', 'wise', 'cool', 'sharp', 'quick', 'brave',
  'clear', 'deep', 'fast', 'firm', 'fresh', 'grand', 'great', 'huge', 'kind', 'light',
  'lucky', 'mighty', 'neat', 'noble', 'proud', 'pure', 'rapid', 'rare', 'rich', 'smooth',
  'solid', 'sound', 'stark', 'steep', 'still', 'stout', 'swift', 'tall', 'tough', 'vast',
  'wild', 'young', 'zesty', 'zen', 'zany', 'zest', 'zap', 'zoom', 'zestful', 'zippy'
];

export const USERNAME_NOUNS = [
  'fox', 'wolf', 'eagle', 'hawk', 'lion', 'tiger', 'bear', 'deer', 'bird', 'fish',
  'star', 'moon', 'sun', 'cloud', 'wave', 'rock', 'tree', 'leaf', 'storm', 'wind',
  'fire', 'ice', 'snow', 'rain', 'mist', 'fog', 'dew', 'frost', 'thunder', 'lightning',
  'river', 'lake', 'ocean', 'hill', 'peak', 'valley', 'cave', 'cliff', 'beach', 'shore',
  'path', 'trail', 'road', 'bridge', 'gate', 'door', 'wall', 'tower', 'fort', 'castle'
];

/**
 * Username generation constants
 */
export const USERNAME_NUM_SUFFIX_MIN = 100;
export const USERNAME_NUM_SUFFIX_MAX = 999;
export const USERNAME_FALLBACK_MIN = 1000;
export const USERNAME_FALLBACK_MAX = 9999;

/**
 * Progress messages for creating step
 */
export const CREATING_PROGRESS_MESSAGES = [
  'Generating cryptographic keys...',
  'Creating your identity...',
  'Setting up your account...',
];

export const CREATING_SUBTITLE = 'This may take a moment';

