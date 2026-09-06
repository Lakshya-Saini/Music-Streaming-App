import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { Model } from 'mongoose';
import { LoginDto } from '../dto/login.dto';
import { User, UserDocument } from '../schemas/user.schema';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Password sign-in is reserved for the single seeded admin account (see scripts/seed-admin.js). */
  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email }).exec();
    if (!user || !user.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.buildAuthResult(user);
  }

  /**
   * Regular users authenticate exclusively through Google - there is no
   * password-based self-registration for them. The first successful Google
   * sign-in for a new email creates the account automatically.
   */
  async loginWithGoogle(idToken: string): Promise<AuthResult> {
    const clientId = this.configService.get<string>('auth.googleClientId');
    if (!clientId) {
      throw new ServiceUnavailableException('Google sign-in is not configured yet.');
    }

    const client = new OAuth2Client(clientId);
    let payload: { sub: string; email?: string; email_verified?: boolean; name?: string };
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      const verified = ticket.getPayload();
      if (!verified) {
        throw new Error('empty payload');
      }
      payload = verified;
    } catch {
      throw new UnauthorizedException('Could not verify Google sign-in. Please try again.');
    }

    if (!payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Your Google account has no verified email address.');
    }

    const email = payload.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email }).exec();

    if (existing) {
      if (existing.role === 'admin') {
        throw new UnauthorizedException('This account signs in with the admin password instead.');
      }
      if (!existing.googleId) {
        existing.googleId = payload.sub;
        existing.authProvider = 'google';
        await existing.save();
      }
      return this.buildAuthResult(existing);
    }

    const created = await this.userModel.create({
      name: payload.name?.trim() || email,
      email,
      googleId: payload.sub,
      authProvider: 'google',
      role: 'user',
    });

    return this.buildAuthResult(created);
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new UnauthorizedException('Account no longer exists.');
    }
    return this.toPublicUser(user);
  }

  private buildAuthResult(user: UserDocument): AuthResult {
    const publicUser = this.toPublicUser(user);
    const accessToken = this.jwtService.sign({
      sub: publicUser.id,
      email: publicUser.email,
      role: publicUser.role,
    });
    return { accessToken, user: publicUser };
  }

  private toPublicUser(user: UserDocument): PublicUser {
    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }
}
