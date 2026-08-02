/** Types shared between the frontend and backend of {{APP_NAME}}. */

/** Response shape of the backend health check. */
export interface HealthResponse {
  status: 'ok';
  service: string;
}
