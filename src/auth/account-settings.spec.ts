import { AuthService } from './auth.service';
import * as bcrypt from 'bcryptjs';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
describe('Email changes', () => {
  let db:any, service:AuthService;
  const actor:any={userId:'owner',tenantId:'tenant'};
  beforeEach(async()=>{
    db={user:{findUniqueOrThrow:jest.fn().mockResolvedValue({id:'owner',tenantId:'tenant',email:'old@example.com',passwordHash:await bcrypt.hash('Current-password',4),tokenVersion:3,isOwner:true}),updateMany:jest.fn().mockResolvedValue({count:1})},passwordReset:{deleteMany:jest.fn()},auditEvent:{create:jest.fn()}};
    db.$transaction=(fn:any)=>fn(db);service=new AuthService(db,{} as any);
  });
  it('lets owner change own email, normalizes it and revokes sessions/recovery links',async()=>{
    await expect(service.changeEmail(actor,{email:' NEW@EXAMPLE.COM ',currentPassword:'Current-password'})).resolves.toEqual({updated:true});
    expect(db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'owner',tokenVersion:3}),data:{email:'new@example.com',tokenVersion:{increment:1}}}));
    expect(db.passwordReset.deleteMany).toHaveBeenCalledWith({where:{userId:'owner'}});
  });
  it('rejects wrong password, concurrent changes and duplicate email',async()=>{
    await expect(service.changeEmail(actor,{email:'new@example.com',currentPassword:'wrong'})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    db.user.updateMany.mockResolvedValue({count:0});
    await expect(service.changeEmail(actor,{email:'new@example.com',currentPassword:'Current-password'})).rejects.toBeInstanceOf(UnauthorizedException);
    db.user.updateMany.mockRejectedValue({code:'P2002'});
    await expect(service.changeEmail(actor,{email:'new@example.com',currentPassword:'Current-password'})).rejects.toBeInstanceOf(ConflictException);
  });
});
