const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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

// En el entorno de pruebas (staging) se usa el MISMO almacenamiento que en producción
// para que se vean las fotos reales, pero sin escribir ni borrar nada en él.
// Actívalo en Railway con la variable STORAGE_SOLO_LECTURA=true (solo en staging).
const soloLectura = process.env.STORAGE_SOLO_LECTURA === 'true';
if (soloLectura) {
  console.log('🔒 Almacenamiento en modo SOLO LECTURA: no se subirán ni borrarán fotos');
}

const storage = multer.memoryStorage();
// Límite de tamaño: sin él, cualquiera (el registro es público) podría llenar la memoria del servidor
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

async function getUploadUrl(key) {
  const command = new PutObjectCommand({
    Bucket: process.env.RAILWAY_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

async function getDownloadUrl(key) {
  const bucketName = process.env.RAILWAY_BUCKET_NAME;
  if (!bucketName) {
    console.log(bucketName);
    console.error('La variable de entorno RAILWAY_BUCKET_NAME no está configurada.');
  }
  const command = new GetObjectCommand({
    Bucket: process.env.RAILWAY_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

async function uploadPhoto(file, carpeta) {
  const key = `${carpeta}/${file.originalname}`;

  if (soloLectura) {
    console.log(`[solo lectura] Subida omitida: ${key}`);
    return `${process.env.S3_PUBLIC_URL}/${key}`;
  }

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

async function deletePhoto(key) {
  if (soloLectura) {
    console.log(`[solo lectura] Borrado omitido: ${key}`);
    return;
  }

  const command = new DeleteObjectCommand({
    Bucket: process.env.RAILWAY_BUCKET_NAME,
    Key: key,
  });
  await s3.send(command);
}

module.exports = { getUploadUrl, getDownloadUrl, uploadPhoto, deletePhoto, upload };