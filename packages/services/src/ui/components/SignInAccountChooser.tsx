import type React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import Avatar from './Avatar';
import type { SwitchableAccount } from '../hooks/useSwitchableAccounts';

export interface SignInAccountChooserProps {
    /** Accounts available on this device / in the caller's graph, current first. */
    accounts: SwitchableAccount[];
    /** Selecting a row — the active account continues, others switch into. */
    onSelectAccount: (account: SwitchableAccount) => void;
    /** "Use another account" → reveal the sign-in options (password / QR / add). */
    onUseAnother: () => void;
    /** The account id currently being switched into (shows a per-row spinner). */
    pendingAccountId?: string | null;
    /** Disables every row while a selection is in flight. */
    disabled?: boolean;
}

/**
 * Google-style account chooser (React Native). Lists every account the user can
 * continue as — device sign-ins + linked graph accounts, from
 * {@link SwitchableAccount} — plus a "Use another account" affordance. Rendered
 * as the FRONT screen of the sign-in surfaces (`SignInModal` web,
 * `OxyAuthScreen` native) whenever accounts exist; selecting a row funnels into
 * the SAME `switchToAccount` path the account switcher uses. When no accounts
 * exist the surfaces skip this and show the sign-in options directly.
 *
 * Presentational + chrome-agnostic (no modal/sheet wrapper, no data fetching) so
 * both containers reuse it and it is unit-testable in isolation.
 */
export const SignInAccountChooser: React.FC<SignInAccountChooserProps> = ({
    accounts,
    onSelectAccount,
    onUseAnother,
    pendingAccountId,
    disabled,
}) => {
    const { colors } = useTheme();

    return (
        <View style={styles.container}>
            {accounts.map((account) => {
                const isPending = pendingAccountId === account.accountId;
                const secondary = account.email;
                return (
                    <TouchableOpacity
                        key={account.accountId}
                        accessibilityRole="button"
                        accessibilityLabel={`Continue as ${account.displayName}`}
                        accessibilityState={{ selected: account.isCurrent, disabled: Boolean(disabled) }}
                        onPress={() => onSelectAccount(account)}
                        disabled={disabled}
                        activeOpacity={0.7}
                        style={[
                            styles.row,
                            { borderColor: colors.border },
                            account.isCurrent && { backgroundColor: colors.primarySubtle, borderColor: colors.primarySubtle },
                            disabled && !isPending && styles.rowDisabled,
                        ]}
                    >
                        <Avatar uri={account.avatarUrl} name={account.displayName} size={44} />
                        <View style={styles.info}>
                            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                                {account.displayName}
                            </Text>
                            {secondary ? (
                                <Text style={[styles.secondary, { color: colors.textSecondary }]} numberOfLines={1}>
                                    {secondary}
                                </Text>
                            ) : null}
                        </View>
                        {isPending ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : account.isCurrent ? (
                            <View style={[styles.currentPill, { backgroundColor: colors.card }]}>
                                <Ionicons name="checkmark" size={14} color={colors.primary} />
                                <Text style={[styles.currentPillText, { color: colors.primary }]}>Signed in</Text>
                            </View>
                        ) : (
                            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                        )}
                    </TouchableOpacity>
                );
            })}

            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Use another account"
                onPress={onUseAnother}
                disabled={disabled}
                activeOpacity={0.7}
                style={[styles.row, { borderColor: colors.border }, disabled && styles.rowDisabled]}
            >
                <View style={[styles.addIcon, { backgroundColor: colors.backgroundSecondary }]}>
                    <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />
                </View>
                <View style={styles.info}>
                    <Text style={[styles.name, { color: colors.text }]}>Use another account</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        gap: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    rowDisabled: {
        opacity: 0.5,
    },
    info: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontSize: 15,
        fontWeight: '600',
    },
    secondary: {
        fontSize: 13,
        marginTop: 2,
    },
    currentPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    currentPillText: {
        fontSize: 12,
        fontWeight: '600',
    },
    addIcon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default SignInAccountChooser;
