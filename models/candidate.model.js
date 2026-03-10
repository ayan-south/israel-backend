// import mongoose from 'mongoose';

// const statusHistorySchema = new mongoose.Schema({
//   status:    { type: String },
//   changedBy: { type: String, default: 'Admin' },
//   note:      { type: String, default: '' },
// }, { timestamps: true });

// const candidateSchema = new mongoose.Schema({

//   // DATA ISOLATION
//   adminId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true,
//     index: true,
//   },

//   // IDENTIFIER TYPE: 'passport' | 'control'
//   identifierType: { type: String, enum: ['passport', 'control'], default: 'passport' },

//   // CORE FIELDS — null when not used (not '' — avoids unique index conflicts)
//   passportNumber:  { type: String, default: null, uppercase: true, trim: true, sparse: true },
//   controlNumber:   { type: String, default: null, uppercase: true, trim: true, sparse: true },
//   visaNumber:      { type: String, default: null, trim: true },
//   fullName:        { type: String, required: true, trim: true },
//   dateOfBirth:     { type: Date,   required: true },
//   profession:      { type: String, default: '', trim: true },
//   companyName:     { type: String, default: '', trim: true },
//   visaIssueDate:   { type: Date,   default: null },
//   visaExpiryDate:  { type: Date,   default: null },
//   visaType:        { type: String, default: '', trim: true },
//   country:         { type: String, required: true, trim: true },
//   status: {
//     type: String,
//     enum: ['Pending', 'Under Review', 'Approved', 'Rejected', 'Issued'],
//     default: 'Pending',
//   },
//   message: { type: String, default: '', trim: true },

//   // Application tracking
//   applicationNumber: { type: String, required: true, uppercase: true, trim: true },
//   applicationDate:   { type: Date, default: Date.now },

//   // Applicant photo
//   photo: { type: String, default: null },

//   // Admin-uploaded visa document (image OR pdf)
//   visaDocument:     { type: String, default: null },
//   visaDocumentType: { type: String, default: null },
//   visaDocumentName: { type: String, default: null },

//   // History & logs
//   statusHistory: [statusHistorySchema],
//   downloadLogs:  [{ downloadedAt: { type: Date, default: Date.now }, ip: String }],

//   // Soft Delete
//   isDeleted: { type: Boolean, default: false },
//   deletedAt: { type: Date, default: null },

// }, { timestamps: true });

// // ── Indexes ──────────────────────────────────────────
// candidateSchema.index({ adminId: 1, isDeleted: 1 });
// candidateSchema.index({ adminId: 1, status: 1 });
// // applicationNumber unique per admin
// candidateSchema.index({ adminId: 1, applicationNumber: 1 }, { unique: true });
// // sparse indexes for passport/control — null values are ignored (no conflict)
// candidateSchema.index({ passportNumber: 1 }, { sparse: true });
// candidateSchema.index({ controlNumber: 1 },  { sparse: true });
// candidateSchema.index({ visaNumber: 1 },     { sparse: true });

// const Candidate = mongoose.model('Candidate', candidateSchema);
// export default Candidate;