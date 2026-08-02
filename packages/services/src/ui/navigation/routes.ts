import type { ComponentType } from 'react';
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
    | 'ChangeAvatar' // Profile-picture source list — the ONE entry into changing an avatar
    | 'AvatarCrop' // Square-crop editor, reached by navigating within the ChangeAvatar surface
    | 'Notifications' // Per-channel notification preferences
    | 'ConnectedApps' // OAuth-authorized third-party apps the user can revoke
    | 'Preferences' // General user preferences (theme, reduce-motion, etc.)
    | 'AccountDialog'; // Unified account switcher + sign-in surface (OxyAccountDialogScreen body)

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
    ChangeAvatar: () => require('../screens/ChangeAvatarScreen').default,
    AvatarCrop: () => require('../screens/AvatarCropScreen').default,
    Notifications: () => require('../screens/NotificationsScreen').default,
    ConnectedApps: () => require('../screens/ConnectedAppsScreen').default,
    Preferences: () => require('../screens/PreferencesScreen').default,
    // Unified account switcher + sign-in surface. Its body lives in the
    // `OxyAccountDialogScreen` component (folded from the standalone dialog); the
    // surface stack provides the Dialog chrome around it.
    AccountDialog: () => require('../components/OxyAccountDialogScreen').default,
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
