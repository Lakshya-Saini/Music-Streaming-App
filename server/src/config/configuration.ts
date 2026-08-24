export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  mongodb: {
    uri: process.env.MONGODB_URI?.trim(),
  },
  aws: {
    region: process.env.AWS_REGION?.trim(),
    s3Bucket: process.env.AWS_S3_BUCKET?.trim(),
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    requireExplicitCredentials: process.env.AWS_REQUIRE_EXPLICIT_CREDENTIALS === 'true',
  },
  ffmpeg: {
    path: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  },
  upload: {
    maxSizeMb: parseInt(process.env.MAX_UPLOAD_SIZE_MB ?? '500', 10),
  },
  client: {
    origin: process.env.CLIENT_ORIGIN?.trim(),
  },
});
