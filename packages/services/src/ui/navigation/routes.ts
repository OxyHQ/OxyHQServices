import type { ComponentType, ReactNode } from 'react';
import type { BaseScreenProps } from '../types/navigation';

// Lazy loading: Screens are loaded on-demand to break require cycles
// This prevents screens (which import OxyContext) from being loaded
// before OxyContext is fully initialized

// Define all available route names
export type RouteName =
    | 'ManageAccount'    // Unified "Manage your Oxy Account" surface
    | 'AccountVerification'
    | 'PaymentGateway'
    | 'Profile'
    | 'LanguageSelector'
    | 'PrivacySettings'
    | 'SearchSettings'
    | 'FileManagement'
    | 'HelpSupport'
    | 'FAQ'
    | 'Feedback'
    | 'LegalDocuments'
    | 'AppInfo'
    | 'PremiumSubscription'
    | 'WelcomeNewUser'
    | 'UserLinks'
    | 'HistoryView'
    | 'SavesCollections'
    | 'EditProfile'      // Profile-editing hub: one row per editable field
    | 'EditProfileField' // Dedicated screen for editing a single profile field
    | 'LearnMoreUsernames' // Informational screen about usernames
    | 'TrustCenter'
    | 'TrustLeaderboard'
    | 'TrustRewards'
    | 'TrustRules'
    | 'AboutTrust'
    | 'TrustFAQ'
    | 'FollowersList'  // List of user's followers
    | 'FollowingList' // List of users being followed
    | 'CreateAccount' // Create a new account (organization / project / bot)
    | 'AccountMembers' // Manage an account's members (invite / roles / transfer)
    | 'AccountSettings' // Per-account profile edit + members + danger zone
    | 'AvatarCrop' // Square-crop editor presented before avatar upload
    | 'Notifications' // Per-channel notification preferences
    | 'ConnectedApps' // OAuth-authorized third-party apps the user can revoke
    | 'Preferences'; // General user preferences (theme, reduce-motion, etc.)

// Lazy screen loaders - functions that return screen components on-demand
// This breaks the require cycle by deferring imports until screens are actually needed
const screenLoaders: Record<RouteName, () => ComponentType<BaseScreenProps>> = {
    ManageAccount: () => require('../screens/ManageAccountScreen').default,
    AccountVerification: () => require('../screens/AccountVerificationScreen').default,
    PaymentGateway: () => require('../screens/PaymentGatewayScreen').default,
    Profile: () => require('../screens/ProfileScreen').default,
    LanguageSelector: () => require('../screens/LanguageSelectorScreen').default,
    PrivacySettings: () => require('../screens/PrivacySettingsScreen').default,
    SearchSettings: () => require('../screens/SearchSettingsScreen').default,
    FileManagement: () => require('../screens/FileManagementScreen').default,
    HelpSupport: () => require('../screens/HelpSupportScreen').default,
    FAQ: () => require('../screens/FAQScreen').default,
    Feedback: () => require('../screens/FeedbackScreen').default,
    LegalDocuments: () => require('../screens/LegalDocumentsScreen').default,
    AppInfo: () => require('../screens/AppInfoScreen').default,
    PremiumSubscription: () => require('../screens/PremiumSubscriptionScreen').default,
    WelcomeNewUser: () => require('../screens/WelcomeNewUserScreen').default,
    UserLinks: () => require('../screens/UserLinksScreen').default,
    HistoryView: () => require('../screens/HistoryViewScreen').default,
    SavesCollections: () => require('../screens/SavesCollectionsScreen').default,
    EditProfile: () => require('../screens/EditProfileScreen').default,
    EditProfileField: () => require('../screens/EditProfileFieldScreen').default,
    // Informational screens
    LearnMoreUsernames: () => require('../screens/LearnMoreUsernamesScreen').default,
    // Oxy Trust screens
    TrustCenter: () => require('../screens/trust/TrustCenterScreen').default,
    TrustLeaderboard: () => require('../screens/trust/TrustLeaderboardScreen').default,
    TrustRewards: () => require('../screens/trust/TrustRewardsScreen').default,
    TrustRules: () => require('../screens/trust/TrustRulesScreen').default,
    AboutTrust: () => require('../screens/trust/TrustAboutScreen').default,
    TrustFAQ: () => require('../screens/trust/TrustFAQScreen').default,
    // User list screens (followers/following)
    FollowersList: () => require('../screens/FollowersListScreen').default,
    FollowingList: () => require('../screens/FollowingListScreen').default,
    CreateAccount: () => require('../screens/CreateAccountScreen').default,
    AccountMembers: () => require('../screens/AccountMembersScreen').default,
    AccountSettings: () => require('../screens/AccountSettingsScreen').default,
    AvatarCrop: () => require('../screens/AvatarCropScreen').default,
    Notifications: () => require('../screens/NotificationsScreen').default,
    ConnectedApps: () => require('../screens/ConnectedAppsScreen').default,
    Preferences: () => require('../screens/PreferencesScreen').default,
};

// Cache loaded components to avoid re-requiring
const screenCache = new Map<RouteName, ComponentType<BaseScreenProps>>();

// Helper function to get a screen component by route name (lazy loaded)
export const getScreenComponent = (routeName: RouteName): ComponentType<BaseScreenProps> | undefined => {
    // Return cached component if available
    if (screenCache.has(routeName)) {
        return screenCache.get(routeName);
    }

    // Lazy load the component
    const loader = screenLoaders[routeName];
    if (loader) {
        try {
            const component = loader();
            screenCache.set(routeName, component);
            return component;
        } catch (error) {
            if (__DEV__) {
                console.error(`[Routes] Failed to load screen: ${routeName}`, error);
            }
            return undefined;
        }
    }

    return undefined;
};

// Helper function to check if a route exists
// Uses the screenLoaders object to check existence without loading the screen
export const isValidRoute = (routeName: string): routeName is RouteName => {
    return routeName in screenLoaders;
};

/**
 * Configuration that BottomSheetRouter applies to the underlying BottomSheet
 * for a given route. Adding new options here is additive — never rename or
 * remove fields without bumping the consumer surface as a breaking change.
 */
export interface SheetRouteConfig {
    /**
     * Which surface hosts the route. `'sheet'` (default) renders the screen in
     * the in-tree `BottomSheet`. `'dialog'` renders it in a responsive Bloom
     * `<Dialog>` (bottom-sheet on narrow, centered card on `md+`) — used for the
     * flagship image picker, which reads better as a centered panel on wide
     * viewports than a full-width sheet. `BottomSheetRouter` keeps BOTH surfaces
     * mounted and routes the active screen into exactly one based on this value.
     */
    presentation: 'sheet' | 'dialog';
    /**
     * When `false`, BottomSheet skips its internal ScrollView and lets the
     * screen own scrolling. Required for screens that render a FlatList,
     * SectionList, or any other VirtualizedList — nesting one inside a
     * plain ScrollView breaks windowing and triggers a RN warning.
     *
     * Ignored for `presentation: 'dialog'` routes — those don't render in the
     * in-tree `BottomSheet` at all.
     */
    scrollable: boolean;
    /**
     * Controls the body-pan activation strategy on the underlying bloom
     * `BottomSheet`. `true` uses RNGH's `manualActivation` with scroll-handoff
     * (recommended for scrollable content — the only RNGH 2.x pattern that
     * doesn't steal vertical events from the inner scroller on Android).
     * `false` uses an always-active body pan that gates on scroll offset.
     *
     * Defaults to `true` for all routes — matches the historical in-tree
     * BottomSheet behavior. Per-route opt-out is possible if a screen needs
     * the always-active pan instead.
     */
    manualActivation: boolean;
    /**
     * When `true`, the backdrop dims proportionally with drag distance (iOS
     * Photos style). Defaults to `true` for all routes — matches the
     * historical in-tree BottomSheet behavior.
     */
    dynamicBackdrop: boolean;
    /**
     * Optional custom handle slot. When provided, replaces the default
     * 36×5 pill drag handle. The handle remains unconditionally draggable
     * via the dedicated handle gesture (when `manualActivation` is `true`).
     * Use sparingly — screens should default to the standard handle for
     * platform consistency.
     */
    handleComponent?: () => ReactNode;
}

/**
 * Predicate matching FileManagementScreen's internal `isImageOnlyPicker`
 * derivation. When the consumer restricts to image MIME types (no videos,
 * no audio, no documents), FileManagement renders the flagship PhotoPickerView
 * which owns its own FlatList. The sheet must therefore stop scrolling
 * children. Kept in sync with `FileManagementScreen` — both check the same
 * disabled MIME type families.
 */
const isFileManagementImageOnlyPicker = (props: Record<string, unknown>): boolean => {
    if (!props.selectMode) return false;
    const disabled = props.disabledMimeTypes;
    if (!Array.isArray(disabled) || disabled.length === 0) return false;
    const has = (predicate: (mt: string) => boolean): boolean =>
        disabled.some((mt) => typeof mt === 'string' && predicate(mt));
    const blocksVideos = has((mt) => mt === 'video/' || mt.startsWith('video/'));
    const blocksAudio = has((mt) => mt === 'audio/' || mt.startsWith('audio/'));
    const blocksDocs = has(
        (mt) => mt === 'application/pdf' || mt === 'application/' || mt.startsWith('application/'),
    );
    return blocksVideos && blocksAudio && blocksDocs;
};

/** Defaults shared across all routes — preserves the historical in-tree BS UX. */
const DEFAULT_SHEET_CONFIG: SheetRouteConfig = {
    presentation: 'sheet',
    scrollable: true,
    manualActivation: true,
    dynamicBackdrop: true,
};

/**
 * Returns the bottom-sheet configuration for a route. Defaults match the
 * pre-refactor in-tree `BottomSheet` (scrollable, manualActivation,
 * dynamicBackdrop). Routes opt out per-field as needed.
 */
export const getSheetConfig = (
    routeName: RouteName | null,
    screenProps: Record<string, unknown>,
): SheetRouteConfig => {
    if (!routeName) return DEFAULT_SHEET_CONFIG;
    if (routeName === 'FileManagement' && isFileManagementImageOnlyPicker(screenProps)) {
        // The flagship photo picker renders in a responsive Bloom `<Dialog>`
        // (bottom-sheet on narrow, centered card on `md+`) rather than the
        // in-tree BottomSheet — it owns its own FlatList and reads better as a
        // centered panel on wide viewports. The Dialog surface, not this
        // config's `scrollable`, governs its scrolling.
        return { ...DEFAULT_SHEET_CONFIG, presentation: 'dialog' };
    }
    return DEFAULT_SHEET_CONFIG;
};
