import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;
export type UserRole = 'user' | 'admin';
export type AuthProvider = 'password' | 'google';

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, unique: true, index: true })
  email!: string;

  /** Only set for password accounts (admin). Google accounts authenticate via googleId instead. */
  @Prop()
  passwordHash?: string;

  /** Google's stable per-account subject id. Only set for accounts created via Google sign-in. */
  @Prop({ index: true, sparse: true, unique: true })
  googleId?: string;

  @Prop({ enum: ['password', 'google'], required: true })
  authProvider!: AuthProvider;

  @Prop({ enum: ['user', 'admin'], required: true, default: 'user' })
  role!: UserRole;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
