/**
 * Reusable Identity Card Component
 * 
 * A flippable ID card component that displays user identity information.
 * Wraps the OxyID (Ticket) component with FrontSide and BackSide.
 */

import React, { useMemo } from 'react';
import { Ticket as OxyID } from '@/components/OxyID';
import { FrontSide } from '@/components/OxyID/front-side';
import { BackSide } from '@/components/OxyID/back-side';

export interface IdentityCardProps {
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  accountCreated?: string;
  publicKey?: string;
  width?: number;
  height?: number;
}

export function IdentityCard({
  displayName,
  username,
  avatarUrl,
  accountCreated,
  publicKey,
  width = 340,
  height = 214,
}: IdentityCardProps) {
  // Format public key for FrontSide display (first 8 + last 8 characters)
  const publicKeyShort = useMemo(() => {
    if (!publicKey) return undefined;
    if (publicKey.length <= 16) return publicKey;
    return `${publicKey.substring(0, 8)}...${publicKey.substring(publicKey.length - 8)}`;
  }, [publicKey]);

  return (
    <OxyID
      width={width}
      height={height}
      frontSide={
        <FrontSide
          displayName={displayName}
          username={username}
          avatarUrl={avatarUrl}
          accountCreated={accountCreated}
          publicKeyShort={publicKeyShort}
        />
      }
      backSide={
        <BackSide
          publicKey={publicKey}
          displayName={displayName}
          accountCreated={accountCreated}
        />
      }
    />
  );
}

