import { Topic, ITopic, TopicType, TopicSource } from '../models/Topic.js';
import type { FilterQuery, ProjectionType, SortOrder } from 'mongoose';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ListOptions {
  type?: TopicType;
  query?: string;
  limit?: number;
  offset?: number;
}

class TopicService {
  /**
   * Atomic upsert — find by lowercase name or create a new topic.
   */
  async findOrCreate(
    name: string,
    type: TopicType,
    source: TopicSource,
    displayName?: string
  ): Promise<ITopic> {
    const normalizedName = name.toLowerCase().trim();
    const display = displayName ?? name.charAt(0).toUpperCase() + name.slice(1);
    const slug = slugify(normalizedName);

    const topic = await Topic.findOneAndUpdate(
      { name: normalizedName },
      {
        $setOnInsert: {
          name: normalizedName,
          slug,
          displayName: display,
          type,
          source,
          description: '',
          aliases: [],
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return topic;
  }

  /**
   * Batch resolve/create topics. Deduplicates input names and returns a
   * Map keyed by the original (lowercased) name.
   */
  async resolveNames(
    names: Array<{ name: string; type: TopicType }>,
    source: TopicSource = TopicSource.AI
  ): Promise<Map<string, ITopic>> {
    // Deduplicate by lowercase name
    const unique = new Map<string, TopicType>();
    for (const entry of names) {
      const key = entry.name.toLowerCase().trim();
      if (key && !unique.has(key)) {
        unique.set(key, entry.type);
      }
    }

    const result = new Map<string, ITopic>();

    // Run upserts in parallel
    const promises = Array.from(unique.entries()).map(async ([name, type]) => {
      const topic = await this.findOrCreate(name, type, source);
      result.set(name, topic);
    });

    await Promise.all(promises);
    return result;
  }

  /**
   * Full-text search across name, displayName, aliases, and description.
   */
  async search(query: string, limit: number = 20): Promise<ITopic[]> {
    if (!query || !query.trim()) return [];

    return Topic.find(
      { $text: { $search: query }, isActive: true },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean<ITopic[]>();
  }

  /**
   * All active category topics sorted alphabetically by displayName.
   */
  async getCategories(): Promise<ITopic[]> {
    return Topic.find({ type: TopicType.CATEGORY, isActive: true })
      .sort({ displayName: 1 })
      .lean<ITopic[]>();
  }

  /**
   * Paginated topic list with optional type filter and text search.
   */
  async list(options: ListOptions = {}): Promise<{ topics: ITopic[]; total: number }> {
    const { type, query, limit = 50, offset = 0 } = options;

    const filter: FilterQuery<ITopic> = { isActive: true };
    if (type) filter.type = type;

    let projection: ProjectionType<ITopic> | null = null;
    let sort: string | { [key: string]: SortOrder | { $meta: string } } = { displayName: 1 as SortOrder };

    if (query && query.trim()) {
      filter.$text = { $search: query };
      projection = { score: { $meta: 'textScore' } } as ProjectionType<ITopic>;
      sort = { score: { $meta: 'textScore' } };
    }

    const [topics, total] = await Promise.all([
      Topic.find(filter, projection).sort(sort).skip(offset).limit(limit).lean<ITopic[]>(),
      Topic.countDocuments(filter),
    ]);

    return { topics, total };
  }

  /**
   * Retrieve a single topic by its slug.
   */
  async getBySlug(slug: string): Promise<ITopic | null> {
    return Topic.findOne({ slug, isActive: true }).lean<ITopic>();
  }

  /**
   * Overlay translations for a given locale onto the displayName and
   * description fields. Returns new objects — does not mutate the input.
   */
  localizeTopics<T extends ITopic | Record<string, unknown>>(topics: T[], locale: string): T[] {
    if (!locale) return topics;

    return topics.map((topic) => {
      const translations = (topic as Record<string, unknown>).translations as
        | Map<string, { displayName: string; description?: string }>
        | Record<string, { displayName: string; description?: string }>
        | undefined;
      if (!translations) return topic;

      // Handle both Map instances and plain objects (from lean queries)
      let translation: { displayName: string; description?: string } | undefined;
      if (translations instanceof Map) {
        translation = translations.get(locale);
      } else {
        translation = translations[locale];
      }

      if (!translation) return topic;

      return {
        ...topic,
        displayName: translation.displayName ?? (topic as Record<string, unknown>).displayName,
        description: translation.description ?? (topic as Record<string, unknown>).description,
      };
    });
  }
}

export const topicService = new TopicService();
export default topicService;
