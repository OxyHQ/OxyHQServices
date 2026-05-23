import type { ComponentType } from 'react';
import type { BaseScreenProps } from '../types/navigation';

// Lazy loading: Screens are loaded on-demand to break require cycles
// This prevents screens (which import OxyContext) from being loaded
// before OxyContext is fully initialized

// Define all available route names
export type RouteName =
    | 'OxyAuth'          // Sign in with Oxy (QR code / deep link to Accounts app)
    | 'AccountOverview'
    | 'AccountSettings'
    | 'AccountCenter'
    | 'AccountSwitcher'
    | 'AccountVerification'
    | 'SessionManagement'
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
    | 'EditProfileField' // Dedicated screen for editing a single profile field
    | 'LearnMoreUsernames' // Informational screen about usernames
    | 'KarmaCenter'
    | 'KarmaLeaderboard'
    | 'KarmaRewards'
    | 'KarmaRules'
    | 'AboutKarma'
    | 'KarmaFAQ'
    | 'FollowersList'  // List of user's followers
    | 'FollowingList' // List of users being followed
    | 'CreateManagedAccount' // Create a new managed sub-account
    | 'AvatarCrop'; // Square-crop editor presented before avatar upload

// Lazy screen loaders - functions that return screen components on-demand
// This breaks the require cycle by deferring imports until screens are actually needed
const screenLoaders: Record<RouteName, () => ComponentType<BaseScreenProps>> = {
    OxyAuth: () => require('../screens/OxyAuthScreen').default,
    AccountOverview: () => require('../screens/AccountOverviewScreen').default,
    AccountSettings: () => require('../screens/AccountSettingsScreen').default,
    AccountCenter: () => require('../screens/AccountCenterScreen').default,
    AccountSwitcher: () => require('../screens/AccountSwitcherScreen').default,
    AccountVerification: () => require('../screens/AccountVerificationScreen').default,
    SessionManagement: () => require('../screens/SessionManagementScreen').default,
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
    EditProfileField: () => require('../screens/EditProfileFieldScreen').default,
    // Informational screens
    LearnMoreUsernames: () => require('../screens/LearnMoreUsernamesScreen').default,
    // Karma screens
    KarmaCenter: () => require('../screens/karma/KarmaCenterScreen').default,
    KarmaLeaderboard: () => require('../screens/karma/KarmaLeaderboardScreen').default,
    KarmaRewards: () => require('../screens/karma/KarmaRewardsScreen').default,
    KarmaRules: () => require('../screens/karma/KarmaRulesScreen').default,
    AboutKarma: () => require('../screens/karma/KarmaAboutScreen').default,
    KarmaFAQ: () => require('../screens/karma/KarmaFAQScreen').default,
    // User list screens (followers/following)
    FollowersList: () => require('../screens/FollowersListScreen').default,
    FollowingList: () => require('../screens/FollowingListScreen').default,
    CreateManagedAccount: () => require('../screens/CreateManagedAccountScreen').default,
    AvatarCrop: () => require('../screens/AvatarCropScreen').default,
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
 * for a given route. Right now this only controls scrolling, but more options
 * (e.g. detached, custom snap points) can land here over time.
 */
export interface SheetRouteConfig {
    /**
     * When `false`, BottomSheet skips its internal ScrollView and lets the
     * screen own scrolling. Required for screens that render a FlatList,
     * SectionList, or any other VirtualizedList — nesting one inside a
     * plain ScrollView breaks windowing and triggers a RN warning.
     */
    scrollable: boolean;
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

/**
 * Returns the bottom-sheet configuration for a route. Defaults to a scrollable
 * sheet (existing behavior); routes opt out by returning `scrollable: false`
 * either unconditionally or conditionally on the supplied `screenProps`.
 */
export const getSheetConfig = (
    routeName: RouteName | null,
    screenProps: Record<string, unknown>,
): SheetRouteConfig => {
    if (!routeName) return { scrollable: true };
    if (routeName === 'FileManagement' && isFileManagementImageOnlyPicker(screenProps)) {
        return { scrollable: false };
    }
    return { scrollable: true };
};
