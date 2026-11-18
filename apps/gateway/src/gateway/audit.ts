import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  ts: string;
  agentId: string;
  tool: string;
  upstream?: string;
  outcome: 'ok' | 'error' | 'denied';
  ms: number;
  detail?: string;
}

@Injectable()
export class AuditService {
  private readonly entries: AuditEntry[] = [];
  private readonly limit = 500;

  record(entry: AuditEntry) {
    this.entries.push(entry);
    while (this.entries.length > this.limit) this.entries.shift();
  }

  tail(count = 50): AuditEntry[] {
    return this.entries.slice(-Math.max(0, count));
  }
}
