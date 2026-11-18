import { Module } from '@nestjs/common';
import { AuditService } from './audit';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { PolicyService } from './policies';
import { UpstreamService } from './upstreams';

@Module({
  controllers: [GatewayController],
  providers: [GatewayService, UpstreamService, PolicyService, AuditService],
  exports: [GatewayService],
})
export class GatewayModule {}
