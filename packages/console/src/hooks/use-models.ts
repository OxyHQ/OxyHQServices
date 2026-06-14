import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';

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
  models: ModelStats[];
  count: number;
  timestamp: string;
}

async function fetchModelsStats(): Promise<ModelsStatsResponse> {
  const response = await apiClient.get<ModelsStatsResponse>('/models/stats');
  return response.data;
}

export function useModelsStats() {
  return useQuery({
    queryKey: ['models-stats'],
    queryFn: fetchModelsStats,
    staleTime: 1000 * 60 * 2,
    retry: 2,
  });
}
