import { createApiClient } from './service.ts';

/** The API client shared by every page: the Web interface is always served by the API's own origin. */
export const apiClient = createApiClient(window.location.origin);
