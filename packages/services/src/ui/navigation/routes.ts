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

export interface RouteConfig {
  component: ComponentType<any>;
  snapPoints: string[];
}

export const routes = {
  SignIn: {
    component: SignInScreen,
    snapPoints: ['10%', '80%'],
  },
  SignUp: {
    component: SignUpScreen,
    snapPoints: ['10%', '90%'],
  },
  RecoverAccount: {
    component: RecoverAccountScreen,
    snapPoints: ['10%', '80%'],
  },
  AccountCenter: {
    component: AccountCenterScreen,
    snapPoints: ['60%', '100%'],
  },
  AccountSwitcher: {
    component: AccountSwitcherScreen,
    snapPoints: ['70%', '100%'],
  },
  SessionManagement: {
    component: SessionManagementScreen,
    snapPoints: ['70%', '100%'],
  },
  AccountOverview: {
    component: AccountOverviewScreen,
    snapPoints: ['60%', '85%'],
  },
  EditProfile: {
    component: AccountSettingsScreen,
    snapPoints: ['60%', '100%'],
  },
  PremiumSubscription: {
    component: PremiumSubscriptionScreen,
    snapPoints: ['70%', '100%'],
  },
  AppInfo: {
    component: AppInfoScreen,
    snapPoints: ['60%', '90%'],
  },
  Feedback: {
    component: FeedbackScreen,
    snapPoints: ['70%', '100%'],
  },
  KarmaCenter: {
    component: KarmaCenterScreen,
    snapPoints: ['60%', '100%'],
  },
  KarmaLeaderboard: {
    component: KarmaLeaderboardScreen,
    snapPoints: ['60%', '100%'],
  },
  KarmaRules: {
    component: KarmaRulesScreen,
    snapPoints: ['60%', '90%'],
  },
  AboutKarma: {
    component: KarmaAboutScreen,
    snapPoints: ['60%', '90%'],
  },
  KarmaRewards: {
    component: KarmaRewardsScreen,
    snapPoints: ['60%', '90%'],
  },
  KarmaFAQ: {
    component: KarmaFAQScreen,
    snapPoints: ['60%', '90%'],
  },
  Profile: {
    component: ProfileScreen,
    snapPoints: ['60%', '90%'],
  },
  UserLinks: {
    component: UserLinksScreen,
    snapPoints: ['60%', '90%'],
  },
  FileManagement: {
    component: FileManagementScreen,
    snapPoints: ['70%', '100%'],
  },
  PaymentGateway: {
    component: PaymentGatewayScreen,
    snapPoints: ['60%', '90%'],
  },
  WelcomeNewUser: {
    component: WelcomeNewUserScreen,
    snapPoints: ['65%', '90%'],
  },
  LanguageSelector: {
    component: LanguageSelectorScreen,
    snapPoints: ['70%', '100%'],
  },
} as const;

export type RouteName = keyof typeof routes;

