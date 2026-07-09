import mongoose, { Document, Schema } from 'mongoose';

/**
 * One-time hub ticket for cross-origin device credential sync.
 *
 * After sign-in on an official web app, the SDK mints a short-lived ticket
 * bound to a target origin (typically `auth.oxy.so`). The hub redeems it
 * server-side and receives a fresh `deviceSecret` — never placed in a URL
 * fragment.
 */
export interface IDeviceHubTicket extends Document {
  ticketHash: string;
  deviceId: string;
  returnOrigin: string;
  usedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceHubTicketSchema: Schema = new Schema(
  {
    ticketHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    returnOrigin: {
      type: String,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

DeviceHubTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

export const DeviceHubTicket = mongoose.model<IDeviceHubTicket>(
  'DeviceHubTicket',
  DeviceHubTicketSchema,
);
export default DeviceHubTicket;
