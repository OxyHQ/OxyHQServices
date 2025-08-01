/**
 * Safe search hook to prevent TypeError when accessing searchProfiles
 * This hook provides a safe interface for search functionality
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useSafeOxy } from '../context/OxyContext';
import { safeHandleSearch, safeLoadMoreResults, isServiceReady } from '../../utils/serviceGuards';
import type { User } from '../../models/interfaces';

export interface SearchState {
  results: User[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  currentQuery: string;
  currentPage: number;
}

export interface UseSearchOptions {
  initialQuery?: string;
  pageSize?: number;
  onError?: (error: any) => void;
  onSuccess?: (results: User[]) => void;
}

export const useSearch = (options: UseSearchOptions = {}) => {
  const { pageSize = 10, onError, onSuccess } = options;
  const oxyContext = useSafeOxy();
  const oxyServices = oxyContext?.oxyServices;
  
  const [state, setState] = useState<SearchState>({
    results: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    currentQuery: options.initialQuery || '',
    currentPage: 1,
  });

  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const abortControllerRef = useRef<AbortController>();

  // Clear any pending search operations on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSearch = useCallback(async (query: string, debounceMs: number = 300) => {
    // Clear any pending search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Early validation
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      setState(prev => ({
        ...prev,
        results: [],
        currentQuery: '',
        error: null,
        hasMore: false,
        currentPage: 1,
      }));
      return;
    }

    // Check if service is ready
    if (!isServiceReady(oxyServices)) {
      setState(prev => ({
        ...prev,
        error: 'Search service is not available. Please try again later.',
        isLoading: false,
      }));
      return;
    }

    const trimmedQuery = query.trim();
    
    // Update state immediately for UI responsiveness
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      currentQuery: trimmedQuery,
      currentPage: 1,
    }));

    // Create abort controller for this search
    abortControllerRef.current = new AbortController();

    // Debounce the search
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        await safeHandleSearch(oxyServices, trimmedQuery, {
          pagination: { page: 1, limit: pageSize, offset: 0 },
          onSuccess: (results: User[]) => {
            // Check if this search is still relevant
            if (abortControllerRef.current?.signal.aborted) return;

            setState(prev => ({
              ...prev,
              results,
              isLoading: false,
              hasMore: results.length === pageSize,
              currentPage: 1,
            }));

            if (onSuccess) onSuccess(results);
          },
          onError: (error: any) => {
            // Check if this search is still relevant
            if (abortControllerRef.current?.signal.aborted) return;

            const errorMessage = error?.message || 'Search failed. Please try again.';
            setState(prev => ({
              ...prev,
              error: errorMessage,
              isLoading: false,
            }));

            if (onError) onError(error);
          },
          onEmpty: () => {
            // Check if this search is still relevant
            if (abortControllerRef.current?.signal.aborted) return;

            setState(prev => ({
              ...prev,
              results: [],
              isLoading: false,
              hasMore: false,
            }));
          },
        });
      } catch (error) {
        // Final catch-all for any unexpected errors
        if (!abortControllerRef.current?.signal.aborted) {
          setState(prev => ({
            ...prev,
            error: 'An unexpected error occurred during search.',
            isLoading: false,
          }));
        }
      }
    }, debounceMs);
  }, [oxyServices, pageSize, onSuccess, onError]);

  const loadMore = useCallback(async () => {
    if (state.isLoadingMore || !state.hasMore || !state.currentQuery) {
      return;
    }

    // Check if service is ready
    if (!isServiceReady(oxyServices)) {
      setState(prev => ({
        ...prev,
        error: 'Search service is not available for loading more results.',
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoadingMore: true, error: null }));

    const nextPage = state.currentPage + 1;

    await safeLoadMoreResults(oxyServices, state.currentQuery, nextPage, {
      pageSize,
      onSuccess: (newResults: User[], hasMore: boolean) => {
        setState(prev => ({
          ...prev,
          results: [...prev.results, ...newResults],
          isLoadingMore: false,
          hasMore,
          currentPage: nextPage,
        }));
      },
      onError: (error: any) => {
        const errorMessage = error?.message || 'Failed to load more results.';
        setState(prev => ({
          ...prev,
          error: errorMessage,
          isLoadingMore: false,
        }));

        if (onError) onError(error);
      },
    });
  }, [state.isLoadingMore, state.hasMore, state.currentQuery, state.currentPage, oxyServices, pageSize, onError]);

  const clearSearch = useCallback(() => {
    // Clear any pending operations
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setState({
      results: [],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      currentQuery: '',
      currentPage: 1,
    });
  }, []);

  const retrySearch = useCallback(() => {
    if (state.currentQuery) {
      handleSearch(state.currentQuery, 0); // No debounce for retry
    }
  }, [state.currentQuery, handleSearch]);

  return {
    // State
    results: state.results,
    isLoading: state.isLoading,
    isLoadingMore: state.isLoadingMore,
    error: state.error,
    hasMore: state.hasMore,
    currentQuery: state.currentQuery,
    currentPage: state.currentPage,
    
    // Actions
    search: handleSearch,
    loadMore,
    clearSearch,
    retrySearch,
    
    // Service status
    isServiceReady: isServiceReady(oxyServices),
  };
};