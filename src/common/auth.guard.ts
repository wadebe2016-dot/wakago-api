import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

export interface AuthUser {
  sub: string;                 // travelerId ou agencyUserId
  role: 'TRAVELER' | 'OWNER' | 'MANAGER' | 'CASHIER' | 'CONTROLLER';
  agencyId?: string;           // présent pour les comptes agence
  phone: string;
}

/** Restreint une route à certains rôles : @Roles('OWNER','MANAGER') */
export const Roles = (...roles: AuthUser['role'][]) => SetMetadata('roles', roles);

/** Injecte l'utilisateur du token : maMethode(@CurrentUser() user: AuthUser) */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer '))
      throw new UnauthorizedException('Token manquant');

    let user: AuthUser;
    try {
      user = await this.jwt.verifyAsync<AuthUser>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }
    req.user = user;

    const roles = this.reflector.getAllAndOverride<AuthUser['role'][]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(user.role))
      throw new ForbiddenException('Rôle insuffisant pour cette action');

    return true;
  }
}
