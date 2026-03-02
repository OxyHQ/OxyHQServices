/**
 * Renders the appropriate card component based on card type.
 * Used in both MessageRow (compact) and MessageDetail (full).
 */

import React from 'react';
import type { MessageCard } from '@/services/emailApi';
import { TripCard } from './TripCard';
import { PurchaseCard } from './PurchaseCard';
import { EventCard } from './EventCard';
import { BillCard } from './BillCard';
import { PackageCard } from './PackageCard';

interface CardRendererProps {
  card: MessageCard;
}

export function CardRenderer({ card }: CardRendererProps) {
  switch (card.type) {
    case 'trip':
      return <TripCard data={card.data} />;
    case 'purchase':
      return <PurchaseCard data={card.data} />;
    case 'event':
      return <EventCard data={card.data} />;
    case 'bill':
      return <BillCard data={card.data} />;
    case 'package':
      return <PackageCard data={card.data} />;
    default:
      return null;
  }
}
