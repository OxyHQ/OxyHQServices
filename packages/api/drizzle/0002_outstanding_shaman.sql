CREATE TABLE "conduct_strikes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"incident_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"decision_revision" integer NOT NULL,
	"application_id" text,
	"effect_type" text NOT NULL,
	"severity" text NOT NULL,
	"risk_points" double precision NOT NULL,
	"family" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"policy_version" text NOT NULL,
	"transaction_id" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conduct_strikes_incident_id_user_id_effect_type_revision_key" UNIQUE("incident_id","user_id","effect_type","decision_revision"),
	CONSTRAINT "conduct_strikes_effect_type_check" CHECK ("conduct_strikes"."effect_type" in ('conduct_penalty', 'report_abuse_penalty', 'review_abuse_penalty')),
	CONSTRAINT "conduct_strikes_severity_check" CHECK ("conduct_strikes"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "conduct_strikes_status_check" CHECK ("conduct_strikes"."status" in ('active', 'expired', 'reversed')),
	CONSTRAINT "conduct_strikes_decision_revision_check" CHECK ("conduct_strikes"."decision_revision" >= 0),
	CONSTRAINT "conduct_strikes_resolution_complete_check" CHECK (("conduct_strikes"."status" = 'active') = ("conduct_strikes"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "moderation_effects" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"incident_id" text NOT NULL,
	"case_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"decision_revision" integer NOT NULL,
	"principal_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"application_id" text NOT NULL,
	"credential_id" text,
	"effect_type" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"points" double precision NOT NULL,
	"active_risk" double precision NOT NULL,
	"severity" text NOT NULL,
	"family" text NOT NULL,
	"repetition_multiplier" double precision NOT NULL,
	"multi_finding_multiplier" double precision NOT NULL,
	"idempotency_key" text NOT NULL,
	"transaction_id" text NOT NULL,
	"strike_id" text,
	"reversal_transaction_id" text,
	"policy_version_universal" text NOT NULL,
	"policy_version_application" text NOT NULL,
	"policy_version_oxy_conduct" text NOT NULL,
	"proof_hash" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_effects_incident_principal_type_revision_key" UNIQUE("incident_id","principal_id","effect_type","decision_revision"),
	CONSTRAINT "moderation_effects_event_id_key" UNIQUE("event_id"),
	CONSTRAINT "moderation_effects_effect_type_check" CHECK ("moderation_effects"."effect_type" in ('conduct_penalty', 'report_abuse_penalty', 'review_abuse_penalty')),
	CONSTRAINT "moderation_effects_status_check" CHECK ("moderation_effects"."status" in ('applied', 'reversed')),
	CONSTRAINT "moderation_effects_severity_check" CHECK ("moderation_effects"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "moderation_effects_decision_revision_check" CHECK ("moderation_effects"."decision_revision" >= 0),
	CONSTRAINT "moderation_effects_reversal_complete_check" CHECK (("moderation_effects"."status" = 'reversed') = ("moderation_effects"."reversed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "moderation_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"conduct_families" text[] NOT NULL,
	"repetition_multipliers" double precision[] NOT NULL,
	"repetition_window_days" integer NOT NULL,
	"multi_finding_secondary_share" double precision NOT NULL,
	"multi_finding_cap" double precision NOT NULL,
	"provisional_effects_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_policies_policy_version_key" UNIQUE("policy_version"),
	CONSTRAINT "moderation_policies_status_check" CHECK ("moderation_policies"."status" in ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "moderation_policy_severity_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"severity" text NOT NULL,
	"points" double precision NOT NULL,
	"risk_points" double precision NOT NULL,
	"risk_expiry_days" integer,
	CONSTRAINT "moderation_policy_severity_rules_policy_id_severity_key" UNIQUE("policy_id","severity"),
	CONSTRAINT "moderation_policy_severity_rules_severity_check" CHECK ("moderation_policy_severity_rules"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "moderation_policy_severity_rules_risk_expiry_days_check" CHECK ("moderation_policy_severity_rules"."risk_expiry_days" is null or "moderation_policy_severity_rules"."risk_expiry_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "moderation_policy_standing_thresholds" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"standing" text NOT NULL,
	"min_risk" double precision NOT NULL,
	CONSTRAINT "moderation_policy_standing_thresholds_policy_id_standing_key" UNIQUE("policy_id","standing"),
	CONSTRAINT "moderation_policy_standing_thresholds_standing_check" CHECK ("moderation_policy_standing_thresholds"."standing" in ('good', 'watch', 'limited', 'restricted')),
	CONSTRAINT "moderation_policy_standing_thresholds_min_risk_check" CHECK ("moderation_policy_standing_thresholds"."min_risk" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_recipient_id_actor_id_type_entity_id_key" UNIQUE("recipient_id","actor_id","type","entity_id"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('like', 'reply', 'mention', 'follow', 'repost', 'quote', 'welcome')),
	CONSTRAINT "notifications_entity_type_check" CHECK ("notifications"."entity_type" in ('post', 'reply', 'profile'))
);
--> statement-breakpoint
CREATE TABLE "reporter_reputation_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"confirmed" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"duplicate" integer DEFAULT 0 NOT NULL,
	"malicious" integer DEFAULT 0 NOT NULL,
	"confirmed_by_family" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rejected_by_family" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reliability" double precision DEFAULT 0.5 NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"last_outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporter_reputation_profiles_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "reporter_reputation_profiles_confirmed_by_family_object_check" CHECK (jsonb_typeof("reporter_reputation_profiles"."confirmed_by_family") = 'object'),
	CONSTRAINT "reporter_reputation_profiles_rejected_by_family_object_check" CHECK (jsonb_typeof("reporter_reputation_profiles"."rejected_by_family") = 'object'),
	CONSTRAINT "reporter_reputation_profiles_counts_check" CHECK ("reporter_reputation_profiles"."confirmed" >= 0 and "reporter_reputation_profiles"."rejected" >= 0 and "reporter_reputation_profiles"."duplicate" >= 0 and "reporter_reputation_profiles"."malicious" >= 0),
	CONSTRAINT "reporter_reputation_profiles_reliability_check" CHECK ("reporter_reputation_profiles"."reliability" >= 0 and "reporter_reputation_profiles"."reliability" <= 1),
	CONSTRAINT "reporter_reputation_profiles_confidence_check" CHECK ("reporter_reputation_profiles"."confidence" >= 0 and "reporter_reputation_profiles"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "restrictions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"restricted_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restrictions_user_id_restricted_id_key" UNIQUE("user_id","restricted_id")
);
--> statement-breakpoint
CREATE TABLE "reviewer_reputation_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"agreements" integer DEFAULT 0 NOT NULL,
	"disagreements" integer DEFAULT 0 NOT NULL,
	"gold_passed" integer DEFAULT 0 NOT NULL,
	"gold_failed" integer DEFAULT 0 NOT NULL,
	"overturned" integer DEFAULT 0 NOT NULL,
	"global_reliability" double precision DEFAULT 0.5 NOT NULL,
	"category_reliability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"language_reliability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unlocked_categories" text[] DEFAULT '{}' NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"seed_weight" double precision DEFAULT 0 NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewer_reputation_profiles_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "reviewer_reputation_profiles_status_check" CHECK ("reviewer_reputation_profiles"."status" in ('active', 'probation', 'suspended')),
	CONSTRAINT "reviewer_reputation_profiles_category_reliability_object_check" CHECK (jsonb_typeof("reviewer_reputation_profiles"."category_reliability") = 'object'),
	CONSTRAINT "reviewer_reputation_profiles_language_reliability_object_check" CHECK (jsonb_typeof("reviewer_reputation_profiles"."language_reliability") = 'object'),
	CONSTRAINT "reviewer_reputation_profiles_counts_check" CHECK ("reviewer_reputation_profiles"."agreements" >= 0 and "reviewer_reputation_profiles"."disagreements" >= 0 and "reviewer_reputation_profiles"."gold_passed" >= 0 and "reviewer_reputation_profiles"."gold_failed" >= 0 and "reviewer_reputation_profiles"."overturned" >= 0),
	CONSTRAINT "reviewer_reputation_profiles_global_reliability_check" CHECK ("reviewer_reputation_profiles"."global_reliability" >= 0 and "reviewer_reputation_profiles"."global_reliability" <= 1)
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"parent_topic_id" text,
	"icon" text,
	"image" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"translations" jsonb,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(display_name, '')), 'B') || setweight(to_tsvector('english', replace(array_to_tsvector(coalesce(aliases, '{}'::text[]))::text, '''', ' ')), 'C') || setweight(to_tsvector('english', coalesce(description, '')), 'D')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_name_key" UNIQUE("name"),
	CONSTRAINT "topics_slug_key" UNIQUE("slug"),
	CONSTRAINT "topics_type_check" CHECK ("topics"."type" in ('category', 'topic', 'entity')),
	CONSTRAINT "topics_source_check" CHECK ("topics"."source" in ('seed', 'ai', 'manual', 'system')),
	CONSTRAINT "topics_translations_object_check" CHECK ("topics"."translations" is null or jsonb_typeof("topics"."translations") = 'object'),
	CONSTRAINT "topics_parent_topic_id_not_self_check" CHECK ("topics"."parent_topic_id" <> "topics"."id")
);
--> statement-breakpoint
CREATE TABLE "user_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"post_views" integer DEFAULT 0 NOT NULL,
	"profile_views" integer DEFAULT 0 NOT NULL,
	"engagement_likes" integer DEFAULT 0 NOT NULL,
	"engagement_replies" integer DEFAULT 0 NOT NULL,
	"engagement_reposts" integer DEFAULT 0 NOT NULL,
	"engagement_quotes" integer DEFAULT 0 NOT NULL,
	"engagement_bookmarks" integer DEFAULT 0 NOT NULL,
	"reach_impressions" integer DEFAULT 0 NOT NULL,
	"reach_unique_viewers" integer DEFAULT 0 NOT NULL,
	"demographics_countries" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"demographics_languages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"peak_activity_hour" integer DEFAULT 0 NOT NULL,
	"peak_activity_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_analytics_user_id_period_date_key" UNIQUE("user_id","period","date"),
	CONSTRAINT "user_analytics_period_check" CHECK ("user_analytics"."period" in ('daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "user_analytics_peak_activity_hour_check" CHECK ("user_analytics"."peak_activity_hour" >= 0 and "user_analytics"."peak_activity_hour" < 24),
	CONSTRAINT "user_analytics_demographics_countries_object_check" CHECK (jsonb_typeof("user_analytics"."demographics_countries") = 'object'),
	CONSTRAINT "user_analytics_demographics_languages_object_check" CHECK (jsonb_typeof("user_analytics"."demographics_languages") = 'object')
);
--> statement-breakpoint
CREATE TABLE "user_app_data" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_app_data_user_id_namespace_key_key" UNIQUE("user_id","namespace","key"),
	CONSTRAINT "user_app_data_namespace_check" CHECK ("user_app_data"."namespace" ~ '^[a-z0-9_-]{1,64}$'),
	CONSTRAINT "user_app_data_key_check" CHECK ("user_app_data"."key" ~ '^[a-z0-9_-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" text PRIMARY KEY NOT NULL,
	"follower_id" text NOT NULL,
	"followed_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_follower_id_followed_id_key" UNIQUE("follower_id","followed_id"),
	CONSTRAINT "user_follows_not_self_check" CHECK ("user_follows"."follower_id" <> "user_follows"."followed_id")
);
--> statement-breakpoint
ALTER TABLE "conduct_strikes" ADD CONSTRAINT "conduct_strikes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conduct_strikes" ADD CONSTRAINT "conduct_strikes_policy_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."moderation_policies"("policy_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_effects" ADD CONSTRAINT "moderation_effects_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_effects" ADD CONSTRAINT "moderation_effects_strike_id_conduct_strikes_id_fk" FOREIGN KEY ("strike_id") REFERENCES "public"."conduct_strikes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_effects" ADD CONSTRAINT "moderation_effects_policy_version_oxy_conduct_fk" FOREIGN KEY ("policy_version_oxy_conduct") REFERENCES "public"."moderation_policies"("policy_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_policy_severity_rules" ADD CONSTRAINT "moderation_policy_severity_rules_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."moderation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_policy_standing_thresholds" ADD CONSTRAINT "moderation_policy_standing_thresholds_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."moderation_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporter_reputation_profiles" ADD CONSTRAINT "reporter_reputation_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_restricted_id_users_id_fk" FOREIGN KEY ("restricted_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_reputation_profiles" ADD CONSTRAINT "reviewer_reputation_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_topic_id_topics_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_analytics" ADD CONSTRAINT "user_analytics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_data" ADD CONSTRAINT "user_app_data_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followed_id_users_id_fk" FOREIGN KEY ("followed_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conduct_strikes_user_id_status_idx" ON "conduct_strikes" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "conduct_strikes_user_id_family_created_at_idx" ON "conduct_strikes" USING btree ("user_id","family","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conduct_strikes_decision_id_decision_revision_idx" ON "conduct_strikes" USING btree ("decision_id","decision_revision");--> statement-breakpoint
CREATE INDEX "conduct_strikes_expires_at_idx" ON "conduct_strikes" USING btree ("expires_at") WHERE "conduct_strikes"."status" = 'active' and "conduct_strikes"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "moderation_effects_decision_id_decision_revision_idx" ON "moderation_effects" USING btree ("decision_id","decision_revision");--> statement-breakpoint
CREATE INDEX "moderation_effects_incident_id_decision_revision_idx" ON "moderation_effects" USING btree ("incident_id","decision_revision");--> statement-breakpoint
CREATE INDEX "moderation_effects_principal_id_applied_at_idx" ON "moderation_effects" USING btree ("principal_id","applied_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_policies_status_idx" ON "moderation_policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviewer_reputation_profiles_status_idx" ON "reviewer_reputation_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "topics_is_active_type_idx" ON "topics" USING btree ("is_active","type");--> statement-breakpoint
CREATE INDEX "topics_parent_topic_id_idx" ON "topics" USING btree ("parent_topic_id") WHERE "topics"."parent_topic_id" is not null;--> statement-breakpoint
CREATE INDEX "topics_search_vector_idx" ON "topics" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "user_follows_followed_id_created_at_id_idx" ON "user_follows" USING btree ("followed_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "user_follows_created_at_id_idx" ON "user_follows" USING btree ("created_at" DESC NULLS LAST,"id");