import { Injectable } from '@nestjs/common';

/**
 * A policy is what the gateway lets one agent do. It is the whole point of
 * running a gateway: the agent is untrusted, the policy is not.
 */
export interface AgentPolicy {
  agentId: string;
  description: string;
  /** Upstream server ids this agent may reach. `*` means all. */
  allowedUpstreams: string[];
  /** Gateway-visible tool names this agent may call. `*` means all. */
  allowedTools: string[];
  /** Tool names this agent may never call. Wins over allowedTools. */
  denyTools: string[];
  /** Only tools annotated `readOnlyHint: true` are exposed. */
  readOnly: boolean;
  /** Allow the upstream server to borrow this agent's model (sampling). */
  allowSampling: boolean;
  /** Allow the upstream server to ask this agent's user (elicitation). */
  allowElicitation: boolean;
  /** Tool calls per minute, per agent. */
  maxCallsPerMinute: number;
  /** Reject tool arguments that look like prompt injection. */
  blockPromptInjection: boolean;
}

export const WILDCARD = '*';

const base = (agentId: string, description: string, patch: Partial<AgentPolicy>): AgentPolicy => ({
  agentId,
  description,
  allowedUpstreams: [WILDCARD],
  allowedTools: [WILDCARD],
  denyTools: [],
  readOnly: false,
  allowSampling: true,
  allowElicitation: true,
  maxCallsPerMinute: 120,
  blockPromptInjection: false,
  ...patch,
});

/** `*` matches everything, `prefix*` matches by prefix, otherwise exact. */
export function matches(patterns: string[], value: string): boolean {
  return patterns.some(
    (p) => p === WILDCARD || p === value || (p.endsWith('*') && value.startsWith(p.slice(0, -1))),
  );
}

@Injectable()
export class PolicyService {
  private readonly policies = new Map<string, AgentPolicy>();

  constructor() {
    this.reset(WILDCARD);
    this.reset('claude-code');
    this.reset('gemini-cli');
    this.reset('readonly');
    this.reset('no-sampling');
  }

  /** Exact match first, then the `*` default. */
  for(agentId: string): AgentPolicy {
    return this.policies.get(agentId) ?? this.policies.get(WILDCARD)!;
  }

  all(): AgentPolicy[] {
    return [...this.policies.values()];
  }

  update(agentId: string, patch: Partial<AgentPolicy>): AgentPolicy {
    const current = this.for(agentId);
    const next: AgentPolicy = { ...current, ...patch, agentId };
    this.policies.set(agentId, next);
    return next;
  }

  reset(agentId: string): AgentPolicy {
    const policy = DEFAULTS[agentId]
      ? base(agentId, DEFAULTS[agentId].description, DEFAULTS[agentId])
      : base(agentId, 'Custom policy', {});
    this.policies.set(agentId, policy);
    return policy;
  }
}

const DEFAULTS: Record<string, Partial<AgentPolicy> & { description: string }> = {
  '*': {
    description: 'Default policy for unknown agents.',
  },
  'claude-code': {
    description: 'Full access: reads, writes, sampling and elicitation.',
  },
  'gemini-cli': {
    description: 'Read-only agent: destructive tools are filtered out of the tool list.',
    readOnly: true,
  },
  readonly: {
    description: 'Read-only and no sampling: the model is never borrowed.',
    readOnly: true,
    allowSampling: false,
  },
  'no-sampling': {
    description: 'Everything allowed except server-initiated sampling.',
    allowSampling: false,
  },
};
