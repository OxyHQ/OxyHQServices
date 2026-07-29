import mongoose, { type Document, Schema } from 'mongoose';

/**
 * A person's track record AS A REPORTER, kept apart from everything else.
 *
 * The reason this is its own collection rather than a few more fields on the
 * balance: the legacy `abuseScore` folded rejected reports together with every
 * negative transaction, so a penalty for unrelated conduct pushed a
 * report-abuse figure upward — and that figure can force a restriction. Keeping
 * reporting counts here, incremented only by reporting outcomes, makes that
 * conflation structurally impossible rather than merely discouraged.
 *
 * Two things the counts deliberately do NOT say:
 *  - A rejected report is not bad faith. It lowers the accuracy estimate gently
 *    and nothing else; only `malicious` records confirmed report abuse.
 *  - A duplicate report is neither right nor wrong. It is counted separately and
 *    moves no estimate, so piling onto a live incident neither rewards nor
 *    punishes.
 *
 * Reliability is a Beta posterior with a neutral prior plus a confidence that
 * grows with sample size, so one accurate report does not certify a reporter and
 * a newcomer keeps a neutral prior instead of starting at zero.
 */
export interface IReporterReputationProfile extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    /** Reports that led to a confirmed violation. */
    confirmed: number;
    /** Reports reviewed and rejected. Not an accusation of bad faith. */
    rejected: number;
    /** Reports that duplicated a live incident. Moves no estimate. */
    duplicate: number;
    /** CONFIRMED report abuse: manipulation, harassment-by-reporting, automation. */
    malicious: number;
    /** Per-conduct-family confirmed counts, for category-aware weighting. */
    confirmedByFamily: Map<string, number>;
    /** Per-conduct-family rejected counts. */
    rejectedByFamily: Map<string, number>;
    /** Smoothed 0..1 accuracy estimate (Beta posterior mean). */
    reliability: number;
    /** 0..1 confidence in that estimate, from effective sample size. */
    confidence: number;
    /** Most recent reporting outcome folded in. */
    lastOutcomeAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ReporterReputationProfileSchema = new Schema<IReporterReputationProfile>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        confirmed: { type: Number, default: 0 },
        rejected: { type: Number, default: 0 },
        duplicate: { type: Number, default: 0 },
        malicious: { type: Number, default: 0 },
        confirmedByFamily: {
            type: Map,
            of: Number,
            default: () => new Map<string, number>(),
        },
        rejectedByFamily: {
            type: Map,
            of: Number,
            default: () => new Map<string, number>(),
        },
        reliability: { type: Number, default: 0.5 },
        confidence: { type: Number, default: 0 },
        lastOutcomeAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

export const ReporterReputationProfile = mongoose.model<IReporterReputationProfile>(
    'ReporterReputationProfile',
    ReporterReputationProfileSchema
);

export default ReporterReputationProfile;
