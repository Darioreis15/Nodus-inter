import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { finalize } from 'rxjs';
import { attachmentUploadOptions } from '../conversations/attachment-upload';
import { PrismaService } from '../prisma/prisma.service';
import { RateGuard } from '../security/rate.guard';

export const idempotencyKeyValid=(key:unknown):key is string=>typeof key==='string' && /^[a-zA-Z0-9_.:-]{8,128}$/.test(key);
export const enabled=()=>process.env.API_QUEUE_ENABLED==='true';
export function setting(name:string,fallback:number,max:number){
 const value=Number(process.env[name]);return Number.isInteger(value)&&value>=1&&value<=max?value:fallback;
}
export function parseParameters(value:unknown){
 if(typeof value!=='string')return value;
 try{return JSON.parse(value);}catch{return value;}
}
export class PublicTemplateDto {
 @Matches(/^[a-z0-9_]{1,512}$/) name:string;
 @Matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/) language:string;
 @Transform(({value})=>parseParameters(value))
 @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(1024,{each:true}) parameters:string[];
}
export class DeliveryDto {
 @IsIn(['TEXT','ATTACHMENT','TEMPLATE']) kind:'TEXT'|'ATTACHMENT'|'TEMPLATE';
 @IsOptional() @IsString() @MinLength(1) @MaxLength(4096) text?:string;
 @IsOptional() @IsString() @MaxLength(1024) caption?:string;
 @IsOptional() @Matches(/^[a-z0-9_]{1,512}$/) name?:string;
 @IsOptional() @Matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/) language?:string;
 @IsOptional() @Transform(({value})=>parseParameters(value))
 @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(1024,{each:true}) parameters?:string[];
}
// Conditional multipart keeps the existing JSON template contract working.
const Parser=FileInterceptor('file',{...attachmentUploadOptions,limits:{...attachmentUploadOptions.limits,fields:6,parts:7,fieldSize:32768}});
@Injectable()
export class DeliveryInput implements NestInterceptor {
 private active=0;
 constructor(private prisma:PrismaService,private rate:RateGuard){}
 async intercept(ctx:ExecutionContext,next:CallHandler){
  const req=ctx.switchToHttp().getRequest();
  const queued=req.route.path.endsWith('/deliveries');
  if(queued && !enabled())throw new ServiceUnavailableException('Fila de integracao desativada.');
  const multipart=req.is('multipart/form-data');
  if(!multipart && !req.is('application/json'))throw new BadRequestException('Envie JSON ou multipart/form-data.');
  if((queued || multipart || req.headers['idempotency-key']) && !idempotencyKeyValid(req.headers['idempotency-key']))throw new BadRequestException('Informe Idempotency-Key de 8 a 128 caracteres.');
  const owned=await this.prisma.conversation.findFirst({where:{id:req.params.id,channel:{tenantId:req.apiTenantId}},select:{id:true}});
  if(!owned)throw new NotFoundException('Conversa nao encontrada.');
  if(multipart){
   await this.rate.consume(`${queued?'queue-upload':'upload'}:${req.apiTenantId}`,queued?setting('API_QUEUE_UPLOADS_PER_MINUTE',10,60):10,60000);
   if(this.active>=2)throw new ServiceUnavailableException('Capacidade de upload ocupada. Aguarde.');
   this.active++;
   try{return await new Parser().intercept(ctx,{handle:()=>next.handle().pipe(finalize(()=>this.active--))});}
   catch(error){this.active--;throw error;}
  }
  return next.handle();
 }
}
