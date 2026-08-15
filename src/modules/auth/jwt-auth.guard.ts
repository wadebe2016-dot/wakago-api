import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtUser } from './auth.service';

/** Rend une route publique : @Public() */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restreint une route à certains profils : @Roles('traveler') ou @Roles('OWNER','CASHIER') */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Récupère l'utilisateur du jeton dans un contrôleur : @CurrentUser() user: JwtUser */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser =>
    ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth: string = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Jeton manquant');

    let user: JwtUser;
    try {
      user = await this.jwt.verifyAsync<JwtUser>(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    req.user = user;

    // Contrôle des rôles éventuels :
    // 'traveler' cible les voyageurs ; 'OWNER'/'MANAGER'/'CASHIER'/'CONTROLLER' ciblent l'agence.
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const ok =
      (roles.includes('traveler') && user.type === 'traveler') ||
      (user.type === 'agency' && user.role && roles.includes(user.role));
    if (!ok) throw new UnauthorizedException('Accès refusé pour ce profil');
    return true;
  }
}
