import type { SystemReadiness } from '../../shared/systemContract';

export interface SystemReadinessService {
  getReadiness(): Promise<SystemReadiness>;
}
