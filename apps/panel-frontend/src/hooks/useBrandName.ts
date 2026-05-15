import { useQuery } from '@tanstack/react-query';
import { getPublicSettings } from '../lib/api';

/**
 * Brand name shown across the panel (LoginPage title, sidebar header).
 * Stored centrally on the backend so it stays consistent across browsers
 * and survives a localStorage wipe.
 *
 * Cached for the session — settings change rarely, no need to re-fetch
 * on every page mount. Falls back to "Ice-Panel" while loading or on
 * fetch error so the UI always renders something.
 */
export function useBrandName(): string {
  const { data } = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: getPublicSettings,
    staleTime: 5 * 60 * 1000, // 5 min
  });
  return data?.brandName ?? 'Floe';
}
