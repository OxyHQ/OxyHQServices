export enum TopicType {
  CATEGORY = 'category',
  TOPIC = 'topic',
  ENTITY = 'entity',
}

export enum TopicSource {
  SEED = 'seed',
  AI = 'ai',
  MANUAL = 'manual',
  SYSTEM = 'system',
}

export interface TopicTranslation {
  displayName: string;
  description?: string;
}

export interface TopicData {
  _id: string;
  name: string;
  slug: string;
  displayName: string;
  description: string;
  type: TopicType;
  source: TopicSource;
  aliases: string[];
  parentTopicId?: string;
  icon?: string;
  image?: string;
  isActive: boolean;
  translations?: Record<string, TopicTranslation>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Paginated result of {@link OxyServices.listTopics}. Mirrors the `GET /topics`
 * envelope so callers keep access to `total`/`offset` for pagination.
 */
export interface TopicListResult {
  topics: TopicData[];
  total: number;
  limit: number;
  offset: number;
}
