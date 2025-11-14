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

export interface RouteConfig {
  component: ComponentType<any>;
  snapPoints: string[];
}

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
] as const;

export type RouteName = typeof routeNames[number];

export const routes: Record<RouteName, RouteConfig> = {
  SignIn: {
    component: SignInScreen as unknown as ComponentType<any>,
    snapPoints: ['10%', '80%'],
  },
  SignUp: {
    component: SignUpScreen as unknown as ComponentType<any>,
    snapPoints: ['10%', '90%'],
  },
  RecoverAccount: {
    component: RecoverAccountScreen as unknown as ComponentType<any>,
    snapPoints: ['10%', '80%'],
  },
  AccountCenter: {
    component: AccountCenterScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '100%'],
  },
  AccountSwitcher: {
    component: AccountSwitcherScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  SessionManagement: {
    component: SessionManagementScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  AccountOverview: {
    component: AccountOverviewScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '85%'],
  },
  EditProfile: {
    component: AccountSettingsScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '100%'],
  },
  PremiumSubscription: {
    component: PremiumSubscriptionScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  AppInfo: {
    component: AppInfoScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  Feedback: {
    component: FeedbackScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  KarmaCenter: {
    component: KarmaCenterScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '100%'],
  },
  KarmaLeaderboard: {
    component: KarmaLeaderboardScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '100%'],
  },
  KarmaRules: {
    component: KarmaRulesScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  AboutKarma: {
    component: KarmaAboutScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  KarmaRewards: {
    component: KarmaRewardsScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  KarmaFAQ: {
    component: KarmaFAQScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  Profile: {
    component: ProfileScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  UserLinks: {
    component: UserLinksScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  FileManagement: {
    component: FileManagementScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  PaymentGateway: {
    component: PaymentGatewayScreen as unknown as ComponentType<any>,
    snapPoints: ['60%', '90%'],
  },
  WelcomeNewUser: {
    component: WelcomeNewUserScreen as unknown as ComponentType<any>,
    snapPoints: ['65%', '90%'],
  },
  LanguageSelector: {
    component: LanguageSelectorScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  HistoryView: {
    component: HistoryViewScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  SavesCollections: {
    component: SavesCollectionsScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  SearchSettings: {
    component: SearchSettingsScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  HelpSupport: {
    component: HelpSupportScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
  LegalDocuments: {
    component: LegalDocumentsScreen as unknown as ComponentType<any>,
    snapPoints: ['70%', '100%'],
  },
};
