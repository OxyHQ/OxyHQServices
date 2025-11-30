import type { ComponentType } from 'react';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import AccountCenterScreen from '../screens/AccountCenterScreen';
import AccountSwitcherScreen from '../screens/AccountSwitcherScreen';
import SessionManagementScreen from '../screens/SessionManagementScreen';
import AccountOverviewScreen from '../screens/AccountOverviewScreen';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import PremiumSubscriptionScreen from '../screens/PremiumSubscriptionScreen';
import AppInfoScreen from '../screens/AppInfoScreen';
import FeedbackScreen from '../screens/FeedbackScreen';
import KarmaCenterScreen from '../screens/karma/KarmaCenterScreen';
import KarmaLeaderboardScreen from '../screens/karma/KarmaLeaderboardScreen';
import KarmaRulesScreen from '../screens/karma/KarmaRulesScreen';
import KarmaAboutScreen from '../screens/karma/KarmaAboutScreen';
import KarmaRewardsScreen from '../screens/karma/KarmaRewardsScreen';
import KarmaFAQScreen from '../screens/karma/KarmaFAQScreen';
import ProfileScreen from '../screens/ProfileScreen';
import UserLinksScreen from '../screens/UserLinksScreen';
import FileManagementScreen from '../screens/FileManagementScreen';
import RecoverAccountScreen from '../screens/RecoverAccountScreen';
import PaymentGatewayScreen from '../screens/PaymentGatewayScreen';
import WelcomeNewUserScreen from '../screens/WelcomeNewUserScreen';
import LanguageSelectorScreen from '../screens/LanguageSelectorScreen';
import HistoryViewScreen from '../screens/HistoryViewScreen';
import SavesCollectionsScreen from '../screens/SavesCollectionsScreen';
import SearchSettingsScreen from '../screens/SearchSettingsScreen';
import HelpSupportScreen from '../screens/HelpSupportScreen';
import LegalDocumentsScreen from '../screens/LegalDocumentsScreen';
import PrivacySettingsScreen from '../screens/PrivacySettingsScreen';
import AccountVerificationScreen from '../screens/AccountVerificationScreen';

export interface RouteConfig {
  component: ComponentType<any>;
  snapPoints: string[];
}

// Helper function to create route config (reduces repetitive type assertions)
const createRoute = <T extends ComponentType<any>>(
  component: T,
  snapPoints: [string, string]
): RouteConfig => ({
  component: component as unknown as ComponentType<any>,
  snapPoints,
});

// Keep a literal list of route names for a precise union type
export const routeNames = [
  'SignIn',
  'SignUp',
  'RecoverAccount',
  'AccountCenter',
  'AccountSwitcher',
  'SessionManagement',
  'AccountOverview',
  'EditProfile',
  'PremiumSubscription',
  'AppInfo',
  'Feedback',
  'KarmaCenter',
  'KarmaLeaderboard',
  'KarmaRules',
  'AboutKarma',
  'KarmaRewards',
  'KarmaFAQ',
  'Profile',
  'UserLinks',
  'FileManagement',
  'PaymentGateway',
  'WelcomeNewUser',
  'LanguageSelector',
  'HistoryView',
  'SavesCollections',
  'SearchSettings',
  'HelpSupport',
  'LegalDocuments',
  'PrivacySettings',
  'AccountVerification',
] as const;

export type RouteName = typeof routeNames[number];

export const routes: Record<RouteName, RouteConfig> = {
  SignIn: createRoute(SignInScreen, ['10%', '80%']),
  SignUp: createRoute(SignUpScreen, ['10%', '90%']),
  RecoverAccount: createRoute(RecoverAccountScreen, ['10%', '80%']),
  AccountCenter: createRoute(AccountCenterScreen, ['60%', '100%']),
  AccountSwitcher: createRoute(AccountSwitcherScreen, ['70%', '100%']),
  SessionManagement: createRoute(SessionManagementScreen, ['70%', '100%']),
  AccountOverview: createRoute(AccountOverviewScreen, ['60%', '85%']),
  EditProfile: createRoute(AccountSettingsScreen, ['60%', '100%']),
  PremiumSubscription: createRoute(PremiumSubscriptionScreen, ['70%', '100%']),
  AppInfo: createRoute(AppInfoScreen, ['60%', '90%']),
  Feedback: createRoute(FeedbackScreen, ['70%', '100%']),
  KarmaCenter: createRoute(KarmaCenterScreen, ['60%', '100%']),
  KarmaLeaderboard: createRoute(KarmaLeaderboardScreen, ['60%', '100%']),
  KarmaRules: createRoute(KarmaRulesScreen, ['60%', '90%']),
  AboutKarma: createRoute(KarmaAboutScreen, ['60%', '90%']),
  KarmaRewards: createRoute(KarmaRewardsScreen, ['60%', '90%']),
  KarmaFAQ: createRoute(KarmaFAQScreen, ['60%', '90%']),
  Profile: createRoute(ProfileScreen, ['60%', '90%']),
  UserLinks: createRoute(UserLinksScreen, ['60%', '90%']),
  FileManagement: createRoute(FileManagementScreen, ['70%', '100%']),
  PaymentGateway: createRoute(PaymentGatewayScreen, ['60%', '90%']),
  WelcomeNewUser: createRoute(WelcomeNewUserScreen, ['65%', '90%']),
  LanguageSelector: createRoute(LanguageSelectorScreen, ['70%', '100%']),
  HistoryView: createRoute(HistoryViewScreen, ['70%', '100%']),
  SavesCollections: createRoute(SavesCollectionsScreen, ['70%', '100%']),
  SearchSettings: createRoute(SearchSettingsScreen, ['70%', '100%']),
  HelpSupport: createRoute(HelpSupportScreen, ['70%', '100%']),
  LegalDocuments: createRoute(LegalDocumentsScreen, ['70%', '100%']),
  PrivacySettings: createRoute(PrivacySettingsScreen, ['60%', '100%']),
  AccountVerification: createRoute(AccountVerificationScreen, ['70%', '100%']),
};
