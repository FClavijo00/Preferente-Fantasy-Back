const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const router = require('express').Router();
const multer = require('multer');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.RAILWAY_STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.RAILWAY_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.RAILWAY_STORAGE_SECRET_KEY,
  },
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

async function getUploadUrl(key) {
  const command = new PutObjectCommand({
    Bucket: process.env.RAILWAY_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

async function getDownloadUrl(key) {
  const command = new GetObjectCommand({
    Bucket: process.env.RAILWAY_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

async function uploadPhoto(file, carpeta) {
  const key = `${carpeta}/${file.originalname}`;

  const command = new PutObjectCommand({
    Bucket: process.env.RAILWAY_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3.send(command);

  // Devuelve la URL pública de la imagen guardada
  return `${process.env.S3_PUBLIC_URL}/${key}`;
}

module.exports = { getUploadUrl, getDownloadUrl, uploadPhoto, upload };