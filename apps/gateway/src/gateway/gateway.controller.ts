import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AuditService } from './audit';
import { AgentPolicy, PolicyService } from './policies';
import { UpstreamService } from './upstreams';

/**
 * The control plane. Everything an operator can change at runtime lives here,
 * so the gateway can be steered while the agents are running.
 */
@Controller()
export class GatewayController {
  constructor(
    private readonly upstreams: UpstreamService,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
  ) {}

  @Get('health')
  async health() {
    return {
      status: 'ok',
      upstreams: await Promise.all(this.upstreams.recipes.map((r) => this.upstreams.probe(r))),
    };
  }

  @Get('upstreams')
  listUpstreams() {
    return this.upstreams.recipes;
  }

  @Get('audit')
  auditTrail(@Query('limit') limit?: string) {
    return this.audit.tail(Number(limit ?? 50));
  }

  @Get('policies')
  policiesList() {
    return this.policies.all();
  }

  @Patch('policies/:agentId')
  updatePolicy(@Param('agentId') agentId: string, @Body() body: Partial<AgentPolicy>) {
    return this.policies.update(agentId, body);
  }
}
