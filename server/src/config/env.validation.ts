import Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().required(),
  AWS_REGION: Joi.string().required(),
  AWS_S3_BUCKET: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  FFMPEG_PATH: Joi.string().default('ffmpeg'),
  FFPROBE_PATH: Joi.string().default('ffprobe'),
  MAX_UPLOAD_SIZE_MB: Joi.number().integer().min(1).max(20480).default(500),
});
