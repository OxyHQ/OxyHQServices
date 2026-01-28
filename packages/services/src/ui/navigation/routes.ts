import React, { type ComponentType } from 'react';
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
    | 'FollowingList'; // List of users being followed

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
    FollowersList: () => {
        const UserListScreen = require('../screens/UserListScreen').default;
        return (props: any) => <UserListScreen {...props} mode="followers" />;
    },
    FollowingList: () => {
        const UserListScreen = require('../screens/UserListScreen').default;
        return (props: any) => <UserListScreen {...props} mode="following" />;
    },
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
