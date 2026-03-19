import multer from 'multer';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// ── Cloudinary config — .env se aata hai ──
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Photo storage (jpg/png only) ──
const photoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder:         'visa-app/photos',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    resource_type:  'image',
    public_id:      `photo_${Date.now()}`,
  }),
});

// ── Visa Doc storage (jpg/png/pdf) ──
const visaDocStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isPdf = ext === '.pdf';
    return {
      folder:        'visa-app/visa-docs',
      resource_type: isPdf ? 'raw' : 'image',   // PDF ke liye 'raw' zaroori hai
      public_id:     `visadoc_${Date.now()}`,
      // PDF ka extension manually lagao — Cloudinary raw mein extension nahi laagti
      format:        isPdf ? 'pdf' : undefined,
    };
  },
});

// ── Combined multer — photo + visaDocument dono handle karta hai ──
const candidateMulter = multer({
  storage: multer.memoryStorage(), // memory mein rakho, hum manually upload karenge
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'photo') {
      /jpeg|jpg|png/.test(ext) ? cb(null, true) : cb(new Error('Photo: JPG/PNG only'));
    } else {
      /jpeg|jpg|png|pdf/.test(ext) ? cb(null, true) : cb(new Error('Visa doc: JPG/PNG/PDF only'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ── Cloudinary pe manually upload karne ka helper ──
export const uploadToCloudinary = (buffer, originalname, folder) => {
  return new Promise((resolve, reject) => {
    const ext = path.extname(originalname).toLowerCase();
    const isPdf = ext === '.pdf';

    // PDF → raw type (image type se PDF "Blocked for delivery" hoti hai Cloudinary pe)
    // Image → image type as usual
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: isPdf ? 'raw' : 'image',
        public_id:     `file_${Date.now()}`,
        // raw type mein extension automatically lagti hai — format nahi dena
      },
      (error, result) => {
        if (error) reject(error);
        else       resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

// ── PDF ke liye signed URL generate karo (raw type ki files ke liye) ──
// Signed URL se Cloudinary authentication bypass hoti hai — 401 nahi aata
export const generateSignedUrl = (publicId, resourceType = 'image') => {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour valid
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type:          'upload',
    sign_url:      true,
    expires_at:    expiresAt,
    secure:        true,
  });
};

// ── Cloudinary se file delete karne ka helper ──
export const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (e) {
    console.error('Cloudinary delete error:', e.message);
  }
};

// ── Public ID + resource type extract karne ka helper (URL se) ──
export const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  try {
    // URL formats:
    // image: https://res.cloudinary.com/cloud/image/upload/v123/folder/file.jpg
    // raw:   https://res.cloudinary.com/cloud/raw/upload/v123/folder/file.pdf
    const parts = url.split('/');
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx === -1) return null;
    const afterUpload = parts.slice(uploadIdx + 2); // version skip
    const withExt = afterUpload.join('/');
    // raw type mein extension public_id ka hissa hoti hai — mat hatao
    // image type mein extension nahi hoti public_id mein
    const resourceType = parts[uploadIdx - 1]; // 'image' ya 'raw'
    if (resourceType === 'raw') {
      return { publicId: withExt, resourceType: 'raw' };
    }
    return { publicId: withExt.replace(/\.[^/.]+$/, ''), resourceType: 'image' };
  } catch { return null; }
};

export const candidateUpload = candidateMulter.fields([
  { name: 'photo',        maxCount: 1 },
  { name: 'visaDocument', maxCount: 1 },
]);

export { cloudinary };
export default candidateMulter;