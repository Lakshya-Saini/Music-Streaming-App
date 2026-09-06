/**
 * One-off CLI script to create (or update the password of) THE admin
 * account directly in MongoDB, bypassing the API entirely - regular users
 * only ever authenticate through Google, and there is no public endpoint
 * that can create or promote an admin.
 *
 * Only one admin account may exist. Re-running this script is only allowed
 * for the same email as the existing admin (e.g. to rotate the password);
 * pointing it at a different email while an admin already exists is refused.
 *
 * Usage:
 *   node scripts/seed-admin.js <email> <password>
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String },
    googleId: { type: String },
    authProvider: { type: String, enum: ['password', 'google'], required: true },
    role: { type: String, enum: ['user', 'admin'], required: true, default: 'user' },
  },
  { timestamps: true, collection: 'users' },
);

function printUsageAndExit() {
  console.error('Usage: node scripts/seed-admin.js <email> <password>');
  console.error('Both an email and a password are required.');
  process.exit(1);
}

async function main() {
  const [, , rawEmail, password] = process.argv;

  if (!rawEmail || !password) {
    printUsageAndExit();
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`"${rawEmail}" doesn't look like a valid email address.`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set (checked server/.env)');
  }

  await mongoose.connect(mongoUri);
  const User = mongoose.model('User', userSchema);

  try {
    const existingAdmin = await User.findOne({ role: 'admin' }).exec();
    if (existingAdmin && existingAdmin.email !== email) {
      throw new Error(
        `An admin account already exists (${existingAdmin.email}). Only one admin account is ` +
          'allowed; run this script again with that same email if you meant to rotate its password.',
      );
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const name = existingAdmin ? existingAdmin.name : 'Admin';

    await User.findOneAndUpdate(
      { email },
      { $set: { name, email, passwordHash, role: 'admin', authProvider: 'password' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    console.log(existingAdmin ? 'Admin password updated:' : 'Admin account created:');
    console.log(`  email: ${email}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to seed admin account:', error.message || error);
  process.exitCode = 1;
});
