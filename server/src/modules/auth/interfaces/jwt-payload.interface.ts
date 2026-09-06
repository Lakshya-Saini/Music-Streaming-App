import { UserRole } from '../schemas/user.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
