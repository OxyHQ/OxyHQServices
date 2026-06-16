import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { TouchableOpacity, StyleSheet, Platform, type LayoutChangeEvent } from 'react-native';
import { getAccountDisplayName } from '@oxyhq/core';
import Avatar from './Avatar';
import AccountMenu, { type AccountMenuAnchor } from './AccountMenu';
import { useOxy } from '../context/OxyContext';
import { useI18n } from '../hooks/useI18n';

export interface AccountMenuButtonProps {
    /** Avatar size (px). Defaults to 36 (Google account chip size). */
    size?: number;
    /** Called when the user picks "Manage your Oxy Account". */
    onNavigateManage: () => void;
    /** Called when the user picks "Add another account". */
    onAddAccount: () => void;
}

const isWeb = Platform.OS === 'web';

/**
 * Avatar entry-point that opens the unified {@link AccountMenu}. Reads the
 * active account from `useOxy()` — never receive user data via props.
 *
 * Renders a small avatar chip (top-right friendly). Click → opens AccountMenu.
 * Pure component: owns only the open-state and the trigger's measured anchor.
 */
const AccountMenuButton: React.FC<AccountMenuButtonProps> = ({
    size = 36,
    onNavigateManage,
    onAddAccount,
}) => {
    const { user, oxyServices, isAuthenticated } = useOxy();
    const { t, locale } = useI18n();
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<AccountMenuAnchor | null>(null);
    const triggerRef = useRef<React.ComponentRef<typeof TouchableOpacity>>(null);

    const measureAnchor = useCallback(() => {
        if (!isWeb || !triggerRef.current) {
            return;
        }
        // RN-Web exposes measure() on host views; use the native API.
        triggerRef.current.measure?.((_x, _y, _w, h, pageX, pageY) => {
            if (typeof window === 'undefined' || typeof pageX !== 'number') {
                return;
            }
            const right = Math.max(8, window.innerWidth - pageX - (_w ?? 0));
            const top = pageY + h + 8;
            setAnchor({ top, right });
        });
    }, []);

    const handleOpen = useCallback(() => {
        measureAnchor();
        setOpen(true);
    }, [measureAnchor]);

    const handleClose = useCallback(() => setOpen(false), []);

    const handleLayout = useCallback((_event: LayoutChangeEvent) => {
        // Re-measure on layout changes so the popover doesn't drift after
        // window resize / sticky-header relayout.
        if (open) {
            measureAnchor();
        }
    }, [measureAnchor, open]);

    const displayName = getAccountDisplayName(user, locale);
    const avatarUri = user?.avatar
        ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb')
        : undefined;

    const accessibilityLabel = isAuthenticated
        ? (t('accountMenu.openWithUser', { name: displayName })
            || `Account menu for ${displayName}`)
        : (t('accountMenu.open') || 'Account menu');

    return (
        <>
            <TouchableOpacity
                ref={triggerRef}
                onPress={handleOpen}
                onLayout={handleLayout}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={t('accountMenu.openHint') || 'Opens the account menu'}
                accessibilityState={{ expanded: open }}
                style={[styles.trigger, { width: size, height: size, borderRadius: size / 2 }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <Avatar uri={avatarUri} name={displayName} size={size} />
            </TouchableOpacity>
            <AccountMenu
                open={open}
                onClose={handleClose}
                onNavigateManage={onNavigateManage}
                onAddAccount={onAddAccount}
                anchor={anchor}
            />
        </>
    );
};

const styles = StyleSheet.create({
    trigger: {
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default AccountMenuButton;
