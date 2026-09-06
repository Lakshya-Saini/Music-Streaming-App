import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3001),
  MONGODB_URI: Joi.string().trim().required(),
  AWS_REGION: Joi.string().trim().required(),
  AWS_S3_BUCKET: Joi.string().trim().required(),
  AWS_REQUIRE_EXPLICIT_CREDENTIALS: Joi.boolean().truthy('true').falsy('false').default(false),
  AWS_ACCESS_KEY_ID: Joi.when('AWS_REQUIRE_EXPLICIT_CREDENTIALS', {
    is: true,
    then: Joi.string().trim().required().messages({
      'any.required': 'AWS_ACCESS_KEY_ID is required for local Docker S3 uploads',
      'string.empty': 'AWS_ACCESS_KEY_ID is required for local Docker S3 uploads',
    }),
    otherwise: Joi.string().trim().allow('').optional(),
  }),
  AWS_SECRET_ACCESS_KEY: Joi.when('AWS_REQUIRE_EXPLICIT_CREDENTIALS', {
    is: true,
    then: Joi.string().trim().required().messages({
      'any.required': 'AWS_SECRET_ACCESS_KEY is required for local Docker S3 uploads',
      'string.empty': 'AWS_SECRET_ACCESS_KEY is required for local Docker S3 uploads',
    }),
    otherwise: Joi.string().trim().allow('').optional(),
  }),
  FFMPEG_PATH: Joi.string().default('ffmpeg'),
  FFPROBE_PATH: Joi.string().default('ffprobe'),
  YT_DLP_PATH: Joi.string().default('yt-dlp'),
  MAX_UPLOAD_SIZE_MB: Joi.number().integer().min(1).max(20480).default(500),
  CLIENT_ORIGIN: Joi.string().trim().allow('').optional(),
  JWT_SECRET: Joi.string().trim().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().trim().default('7d'),
  GOOGLE_CLIENT_ID: Joi.string().trim().allow('').optional(),
});
