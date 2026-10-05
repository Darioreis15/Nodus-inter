import { Type } from 'class-transformer';
import { IsDefined, ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
export class ScheduleDto {
  @IsBoolean() enabled: boolean;
  @IsArray() @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) days: number[];
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) start: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) end: string;
}
export class AvailabilityDto extends ScheduleDto {
  @IsBoolean() available: boolean;
}
export class DepartmentDto {
  @IsUUID() id: string;
  @IsString() @MinLength(1) @MaxLength(60) name: string;
}
export class FunnelStageDto {
  @IsOptional() @IsBoolean() waitForReply?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) completionMessage?: string;
  @IsOptional() @IsUUID() fromStageId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsUUID() id: string;
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsString() @MaxLength(100) keyword: string;
  @IsString() @MaxLength(4000) message: string;
  @IsOptional() @IsUUID() userId?: string;
}
export class WorkspaceDto {
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DepartmentDto) departments?: DepartmentDto[];
  @IsOptional() @IsUUID() awayDepartmentId?: string | null;
  @IsString() @MaxLength(80) timezone: string;
  @IsDefined() @ValidateNested() @Type(() => ScheduleDto) businessHours: ScheduleDto;
  @IsString() @MaxLength(4000) awayMessage: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FunnelStageDto) stages: FunnelStageDto[];
}
export const defaults = { timezone: 'America/Sao_Paulo', businessHours: { enabled: false, days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' }, awayMessage: '', awayDepartmentId: null, departments: [], stages: [] };
export function withinHours(schedule: ScheduleDto | undefined, timezone: string, now = new Date()): boolean {
  if (!schedule?.enabled) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  const time = `${get('hour')}:${get('minute')}`;
  if (schedule.start === schedule.end) return false;
  if (schedule.start < schedule.end) return schedule.days.includes(day) && time >= schedule.start && time < schedule.end;
  return (schedule.days.includes(day) && time >= schedule.start) || (schedule.days.includes((day + 6) % 7) && time < schedule.end);
}
