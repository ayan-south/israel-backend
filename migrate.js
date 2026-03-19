/**
 * ─────────────────────────────────────────────────────
 *  MIGRATION SCRIPT — Local paths → Cloudinary URLs
 *  
 *  Kya karta hai:
 *  1. MongoDB se saare candidates fetch karta hai
 *  2. Jo records mein local path hai (uploads/...) unhe dhundta hai
 *  3. Cloudinary pe file ka naam se URL match karta hai
 *  4. MongoDB mein URL update kar deta hai
 * 
 *  Ek baar chalao — dobara chalane ki zaroorat nahi
 * ─────────────────────────────────────────────────────
 * 
 *  CHALANE KA TARIKA:
 *  node migrate.js
 * ─────────────────────────────────────────────────────
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';

// ── Cloudinary config ──
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Candidate model (simple version — sirf migration ke liye) ──
const candidateSchema = new mongoose.Schema({
  photo:            { type: String, default: null },
  visaDocument:     { type: String, default: null },
  visaDocumentType: { type: String, default: null },
  visaDocumentName: { type: String, default: null },
  applicationNumber: String,
}, { strict: false });

const Candidate = mongoose.model('Candidate', candidateSchema);

// ── Helper: kya yeh local path hai? ──
const isLocalPath = (val) => {
  if (!val) return false;
  // Local path hoga agar: backslash ho, ya 'uploads/' se shuru ho, ya '/' se shuru na ho http ke saath
  return val.includes('uploads/') || val.includes('uploads\\') || val.startsWith('/');
};

// ── Helper: file ka naam extract karo path se ──
const getFileName = (filePath) => {
  if (!filePath) return null;
  // Windows ya Linux dono ke liye
  return filePath.split(/[/\\]/).pop();
};

// ── Helper: Cloudinary pe file dhundo naam se ──
const findOnCloudinary = async (fileName, folder) => {
  try {
    // Extension hatao — Cloudinary public_id mein extension nahi hoti (images ke liye)
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
    
    // Pehle folder mein search karo
    const result = await cloudinary.search
      .expression(`folder:visa-app/${folder} AND filename:${nameWithoutExt}`)
      .max_results(1)
      .execute();

    if (result.resources?.length > 0) {
      return result.resources[0].secure_url;
    }

    // Agar nahi mila toh raw resources mein search karo (PDF ke liye)
    const rawResult = await cloudinary.search
      .expression(`folder:visa-app/${folder} AND public_id:visa-app/${folder}/${nameWithoutExt}`)
      .max_results(1)
      .execute();

    if (rawResult.resources?.length > 0) {
      return rawResult.resources[0].secure_url;
    }

    return null;
  } catch (e) {
    console.error(`  ⚠️  Search error for "${fileName}":`, e.message);
    return null;
  }
};

// ── MAIN MIGRATION ──
const migrate = async () => {
  console.log('\n🚀 Migration shuru ho rahi hai...\n');

  // MongoDB connect karo
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB connected\n');

  // Saare candidates lo jisme local path hai
  const candidates = await Candidate.find({
    $or: [
      { photo:        { $regex: 'uploads', $options: 'i' } },
      { visaDocument: { $regex: 'uploads', $options: 'i' } },
    ]
  });

  console.log(`📋 ${candidates.length} records mein local paths mili hain\n`);

  if (candidates.length === 0) {
    console.log('✅ Koi migration ki zaroorat nahi — sab already updated hain!');
    await mongoose.disconnect();
    return;
  }

  let successCount = 0;
  let failCount    = 0;
  let skipCount    = 0;

  for (const c of candidates) {
    console.log(`\n📄 Processing: ${c.applicationNumber || c._id}`);
    let updated = false;

    // ── Photo migrate karo ──
    if (isLocalPath(c.photo)) {
      const fileName = getFileName(c.photo);
      console.log(`  🖼️  Photo: ${fileName}`);

      if (fileName) {
        const cloudUrl = await findOnCloudinary(fileName, 'photos');
        if (cloudUrl) {
          c.photo = cloudUrl;
          updated = true;
          console.log(`  ✅ Photo updated: ${cloudUrl}`);
        } else {
          console.log(`  ❌ Photo Cloudinary pe nahi mili: ${fileName}`);
          failCount++;
        }
      }
    } else {
      if (c.photo) console.log(`  ⏭️  Photo already Cloudinary URL hai — skip`);
    }

    // ── Visa Document migrate karo ──
    if (isLocalPath(c.visaDocument)) {
      const fileName = getFileName(c.visaDocument);
      const folder   = 'visa-docs';
      console.log(`  📎 Visa Doc: ${fileName}`);

      if (fileName) {
        const cloudUrl = await findOnCloudinary(fileName, folder);
        if (cloudUrl) {
          c.visaDocument = cloudUrl;
          updated = true;
          console.log(`  ✅ Visa doc updated: ${cloudUrl}`);
        } else {
          console.log(`  ❌ Visa doc Cloudinary pe nahi mila: ${fileName}`);
          failCount++;
        }
      }
    } else {
      if (c.visaDocument) console.log(`  ⏭️  Visa doc already Cloudinary URL hai — skip`);
    }

    // ── Save karo agar kuch update hua ──
    if (updated) {
      await Candidate.updateOne(
        { _id: c._id },
        {
          $set: {
            photo:        c.photo,
            visaDocument: c.visaDocument,
          }
        }
      );
      successCount++;
      console.log(`  💾 Saved!`);
    } else {
      skipCount++;
    }
  }

  // ── Summary ──
  console.log('\n─────────────────────────────────');
  console.log('📊 MIGRATION SUMMARY:');
  console.log(`  ✅ Successfully updated: ${successCount}`);
  console.log(`  ❌ Failed (file not found on Cloudinary): ${failCount}`);
  console.log(`  ⏭️  Skipped (already updated): ${skipCount}`);
  console.log('─────────────────────────────────\n');

  if (failCount > 0) {
    console.log('⚠️  Kuch files Cloudinary pe nahi mili — manually check karo ki woh files upload hui hain ya nahi.\n');
  } else {
    console.log('🎉 Migration complete! Ab saari files Cloudinary se serve hongi.\n');
  }

  await mongoose.disconnect();
  console.log('🔌 MongoDB disconnected\n');
};

migrate().catch(err => {
  console.error('💥 Migration failed:', err);
  process.exit(1);
});