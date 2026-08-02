import mongoose, { type Document, Schema } from 'mongoose';

/**
 * A person's track record AS A REVIEWER — per category and language, not as one
 * global number.
 *
 * Competence in one category says very little about another, and a reviewer
 * fluent in the language of the material is not thereby calibrated on its
 * policy. A single global reliability figure hides both, which is why the maps
 * exist.
 *
 * What moves these numbers, and what deliberately does not:
 *  - GOLD CASES are the primary calibration signal: a case with a known correct
 *    answer measures the reviewer without measuring the crowd.
 *  - An accepted APPEAL is a strong signal but never the only one — a single
 *    overturned decision is not a verdict on a reviewer.
 *  - DISAGREEING WITH THE MAJORITY does not penalise. A jury that punishes
 *    dissent stops being a jury and becomes a conformity test.
 *  - Collusion, leaking, random answering and multi-account use are a different
 *    thing entirely: they are confirmed review abuse, they suspend the profile,
 *    and they land on the conduct axis.
 *
 * `seedWeight` is the small initial credit a reviewer's general Oxy reputation
 * lends before they have any review history, and it decays to nothing as real
 * history accumulates: standing in the wider network is a hint about a newcomer,
 * not a substitute for evidence.
 */
export interface IReviewerReputationProfile extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    /** `active` reviewers can be drawn; `suspended` cannot. */
    status: 'active' | 'probation' | 'suspended';
    /** Reviews whose decision matched the resolved outcome. */
    agreements: number;
    /** Reviews whose decision did not. Not a penalty on its own. */
    disagreements: number;
    /** Gold cases answered correctly — the primary calibration signal. */
    goldPassed: number;
    /** Gold cases answered incorrectly. */
    goldFailed: number;
    /** Decisions this reviewer contributed to that an appeal later overturned. */
    overturned: number;
    /** Smoothed 0..1 global reliability. */
    globalReliability: number;
    /** Per-category reliability. A reviewer may be trusted in one and not another. */
    categoryReliability: Map<string, number>;
    /** Per-language reliability. */
    languageReliability: Map<string, number>;
    /** Categories the reviewer has passed calibration for. */
    unlockedCategories: string[];
    /** Languages the reviewer declared and was calibrated in. */
    languages: string[];
    /**
     * Initial credit from the reviewer's general Oxy standing, decaying toward
     * zero as review history accumulates.
     */
    seedWeight: number;
    /** When the profile was suspended, if it was. */
    suspendedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ReviewerReputationProfileSchema = new Schema<IReviewerReputationProfile>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        status: {
            type: String,
            enum: ['active', 'probation', 'suspended'],
            default: 'active',
            index: true,
        },
        agreements: { type: Number, default: 0 },
        disagreements: { type: Number, default: 0 },
        goldPassed: { type: Number, default: 0 },
        goldFailed: { type: Number, default: 0 },
        overturned: { type: Number, default: 0 },
        globalReliability: { type: Number, default: 0.5 },
        categoryReliability: {
            type: Map,
            of: Number,
            default: () => new Map<string, number>(),
        },
        languageReliability: {
            type: Map,
            of: Number,
            default: () => new Map<string, number>(),
        },
        unlockedCategories: { type: [String], default: [] },
        languages: { type: [String], default: [] },
        seedWeight: { type: Number, default: 0 },
        suspendedAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

export const ReviewerReputationProfile = mongoose.model<IReviewerReputationProfile>(
    'ReviewerReputationProfile',
    ReviewerReputationProfileSchema
);

export default ReviewerReputationProfile;
