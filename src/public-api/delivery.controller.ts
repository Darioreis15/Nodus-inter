import { NodusResponseInterceptor } from './nodus-response';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors, UnauthorizedException } from '@nestjs/common';
import { AttachmentFile } from '../conversations/attachment-upload';
import { secretMatches } from '../security/secrets';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CurrentApiTenant } from './decorators/current-api-tenant.decorator';
import { DeliveryDto, DeliveryInput } from './delivery-input';
import { DeliveryService } from './delivery.service';
import { DeliveryWorker } from './delivery.worker';
@UseInterceptors(NodusResponseInterceptor)
@Controller(['public/v1', 'public/v2'])
@UseGuards(ApiKeyGuard)
export class DeliveryController {
 constructor(private service:DeliveryService){}
 @Post('conversations/:id/deliveries') @HttpCode(202)
 @UseInterceptors(DeliveryInput)
 enqueue(@CurrentApiTenant() tenantId:string,@Param('id') id:string,@Headers('idempotency-key') key:string,@Req() req:any,@Body() dto:DeliveryDto,@UploadedFile() file?:AttachmentFile){return this.service.enqueue(tenantId,id,key,req.apiKeyHash,dto,file);}
 @Get('deliveries') list(@CurrentApiTenant() tenantId:string,@Query('cursor') cursor?:string){return this.service.list(tenantId,cursor);}
 @Get('deliveries/:id') get(@CurrentApiTenant() tenantId:string,@Param('id') id:string){return this.service.get(tenantId,id);}
 @Delete('deliveries/:id') cancel(@CurrentApiTenant() tenantId:string,@Param('id') id:string){return this.service.cancel(tenantId,id);}
}
@Controller('internal/api-deliveries')
export class DeliveryRunController {
 constructor(private worker:DeliveryWorker){}
 @Post('run') @HttpCode(200)
 run(@Headers('x-api-queue-token') token?:string){
  const expected=process.env.API_QUEUE_RUN_TOKEN;
  if(!expected || expected.length<32 || !secretMatches(token,expected))throw new UnauthorizedException();
  return this.worker.tick();
 }
}
