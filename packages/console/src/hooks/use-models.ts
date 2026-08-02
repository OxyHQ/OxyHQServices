import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@oxyhq/services';

export interface ModelStats {
  id: string;
  name: string;
  description: string;
  tier: string;
  category: string;
  creditMultiplier: number;
  avgLatencyMs: number;
  uptime: number;
  successRate: number;
  totalRequests: number;
  isHealthy: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxTokens: number;
}

export interface ModelsStatsResponse {
  models: Array<ModelStats>;
  count: number;
  timestamp: string;
}

export function useModelsStats() {
  const { oxyServices } = useAuth();

  return useQuery({
    queryKey: ['models-stats'],
    queryFn: () => oxyServices.makeRequest<ModelsStatsResponse>('GET', '/models/stats'),
    staleTime: 1000 * 60 * 2,
    retry: 2,
  });
}
