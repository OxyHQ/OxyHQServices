import React, { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { EncryptedBackupGenerator } from '@/components/identity/EncryptedBackupGenerator';
import { useOxy } from '@oxyhq/services';

export default function CreateBackupScreen() {
    const router = useRouter();
    const { getPublicKey, isAuthenticated } = useOxy();
    const [publicKey, setPublicKey] = useState<string | null>(null);

    useEffect(() => {
        const loadPublicKey = async () => {
            if (isAuthenticated && getPublicKey) {
                try {
                    const pk = await getPublicKey();
                    setPublicKey(pk);
                } catch (error) {
                    console.error('Failed to get public key:', error);
                }
            }
        };
        loadPublicKey();
    }, [isAuthenticated, getPublicKey]);

    const handleComplete = () => {
        router.back();
    };

    const handleCancel = () => {
        router.back();
    };

    return (
        <ScreenContentWrapper>
            <EncryptedBackupGenerator
                publicKey={publicKey}
                onComplete={handleComplete}
                onCancel={handleCancel}
            />
        </ScreenContentWrapper>
    );
}

