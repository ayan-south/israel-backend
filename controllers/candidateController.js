import Candidate from '../models/Candidate.js';
import logger from '../utils/logger.js';
import XLSX from 'xlsx';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper: build admin-scoped filter
const adminFilter = (req, extra = {}) => {
  const f = { isDeleted: false, ...extra };
  if (req.adminScope) f.adminId = req.adminScope;
  return f;
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '';

// GET /api/candidates/stats
export const getStats = async (req, res, next) => {
  try {
    const base = adminFilter(req);
    const now  = new Date();
    const som  = new Date(now.getFullYear(), now.getMonth(), 1);
    const [total, approved, rejected, pending, underReview, issued, deletedCount, thisMonth] =
      await Promise.all([
        Candidate.countDocuments(base),
        Candidate.countDocuments({ ...base, status: 'Approved' }),
        Candidate.countDocuments({ ...base, status: 'Rejected' }),
        Candidate.countDocuments({ ...base, status: 'Pending' }),
        Candidate.countDocuments({ ...base, status: 'Under Review' }),
        Candidate.countDocuments({ ...base, status: 'Issued' }),
        Candidate.countDocuments({ ...adminFilter(req, { isDeleted: true }) }),
        Candidate.countDocuments({ ...base, createdAt: { $gte: som } }),
      ]);
    res.json({ success: true, stats: { total, approved, rejected, pending, underReview, issued, deletedCount, thisMonth } });
  } catch (err) { next(err); }
};

// GET /api/candidates
export const getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 15, search = '', status = '' } = req.query;
    const query = adminFilter(req);

    if (search.trim()) {
      query.$or = [
        { fullName:          { $regex: search.trim(), $options: 'i' } },
        { passportNumber:    { $regex: search.trim(), $options: 'i' } },
        { controlNumber:     { $regex: search.trim(), $options: 'i' } },
        { applicationNumber: { $regex: search.trim(), $options: 'i' } },
        { visaNumber:        { $regex: search.trim(), $options: 'i' } },
      ];
    }
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      Candidate.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).select('-downloadLogs').lean(),
      Candidate.countDocuments(query),
    ]);
    res.json({ success: true, data, pagination: { current: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) { next(err); }
};

// GET /api/candidates/:id
export const getOne = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, isDeleted: false };
    if (req.adminScope) query.adminId = req.adminScope;
    const c = await Candidate.findOne(query);
    if (!c) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
};

// POST /api/candidates
export const addCandidate = async (req, res, next) => {
  try {
    const {
      identifierType, passportNumber, controlNumber,
      visaNumber, fullName, dateOfBirth,
      profession, companyName, visaIssueDate, visaExpiryDate,
      visaType, country, status, message, applicationNumber, applicationDate,
    } = req.body;

    if (!fullName || !dateOfBirth || !country || !applicationNumber) {
      return res.status(400).json({ success: false, message: 'Required fields missing.' });
    }

    const idType = identifierType || 'passport';
    const idValue = idType === 'control' ? controlNumber?.toUpperCase().trim() : passportNumber?.toUpperCase().trim();
    if (!idValue) {
      return res.status(400).json({ success: false, message: `${idType === 'control' ? 'Control' : 'Passport'} number required.` });
    }

    const adminId = req.user.role === 'user' ? req.user.createdBy : req.user._id;

    // Duplicate check
    const dupApp = await Candidate.findOne({ adminId, applicationNumber: applicationNumber.toUpperCase().trim() });
    if (dupApp) return res.status(409).json({ success: false, message: `Application "${applicationNumber}" already exists.` });

    const initStatus = status || 'Pending';
    const photoPath = req.files?.photo?.[0]?.path || null;

    // Visa document (image or PDF)
    let visaDocPath = null, visaDocType = null, visaDocName = null;
    if (req.files?.visaDocument?.[0]) {
      const vf = req.files.visaDocument[0];
      visaDocPath = vf.path;
      visaDocName = vf.originalname;
      const ext = path.extname(vf.originalname).toLowerCase();
      visaDocType = ext === '.pdf' ? 'pdf' : 'image';
    }

    const candidate = await Candidate.create({
      adminId,
      identifierType: idType,
      passportNumber:  idType === 'passport' ? idValue : (passportNumber?.toUpperCase().trim() || null),
      controlNumber:   idType === 'control'  ? idValue : null,
      visaNumber:      visaNumber?.trim()     || '',
      fullName:        fullName.trim(),
      dateOfBirth,
      profession:      profession?.trim()     || '',
      companyName:     companyName?.trim()    || '',
      visaIssueDate:   visaIssueDate          || null,
      visaExpiryDate:  visaExpiryDate         || null,
      visaType:        visaType?.trim()       || '',
      country:         country.trim(),
      status:          initStatus,
      message:         message?.trim()        || '',
      applicationNumber: applicationNumber.toUpperCase().trim(),
      applicationDate: applicationDate        || new Date(),
      photo:           photoPath,
      visaDocument:    visaDocPath,
      visaDocumentType: visaDocType,
      visaDocumentName: visaDocName,
      statusHistory:   [{ status: initStatus, changedBy: req.user.name || req.user.email }],
    });

    logger.info('Candidate added', { app: candidate.applicationNumber, by: req.user.email });
    res.status(201).json({ success: true, message: 'Candidate added.', data: candidate });
  } catch (err) { next(err); }
};

// PUT /api/candidates/:id
export const editCandidate = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, isDeleted: false };
    if (req.adminScope) query.adminId = req.adminScope;

    const candidate = await Candidate.findOne(query);
    if (!candidate) return res.status(404).json({ success: false, message: 'Not found.' });

    const {
      identifierType, passportNumber, controlNumber,
      visaNumber, fullName, dateOfBirth,
      profession, companyName, visaIssueDate, visaExpiryDate,
      visaType, country, status, message, applicationDate,
    } = req.body;

    const statusChanged = status && status !== candidate.status;

    // Update identifier
    if (identifierType) candidate.identifierType = identifierType;
    if (identifierType === 'passport' && passportNumber) {
      candidate.passportNumber = passportNumber.toUpperCase().trim();
      candidate.controlNumber = null;
    }
    if (identifierType === "control" && controlNumber) {
      candidate.controlNumber = controlNumber.toUpperCase().trim();
      if (passportNumber !== undefined) candidate.passportNumber = passportNumber?.toUpperCase().trim() || null;
    }

    if (fullName)            candidate.fullName       = fullName.trim();
    if (dateOfBirth)         candidate.dateOfBirth    = dateOfBirth;
    if (profession !== undefined) candidate.profession = profession?.trim() || '';
    if (companyName !== undefined) candidate.companyName = companyName?.trim() || '';
    // if (visaNumber  !== undefined) candidate.visaNumber  = visaNumber?.trim()  || '';
    if (visaIssueDate !== undefined) candidate.visaIssueDate = visaIssueDate || null;
    if (visaExpiryDate !== undefined) candidate.visaExpiryDate = visaExpiryDate || null;
    if (visaType !== undefined) candidate.visaType   = visaType?.trim() || '';
    if (country)             candidate.country        = country.trim();
    if (message !== undefined) candidate.message    = message?.trim() || '';
    if (applicationDate)     candidate.applicationDate = applicationDate;

    // Photo update
    if (req.files?.photo?.[0]) candidate.photo = req.files.photo[0].path;

    // Visa document update (replaces old one)
    if (req.files?.visaDocument?.[0]) {
      const vf = req.files.visaDocument[0];
      candidate.visaDocument     = vf.path;
      candidate.visaDocumentName = vf.originalname;
      const ext = path.extname(vf.originalname).toLowerCase();
      candidate.visaDocumentType = ext === '.pdf' ? 'pdf' : 'image';
    }

    if (statusChanged) {
      candidate.status = status;
      candidate.statusHistory.push({ status, changedBy: req.user.name || req.user.email });
    }

    await candidate.save();
    const updated = await Candidate.findById(candidate._id);
    logger.info('Candidate updated', { app: candidate.applicationNumber, by: req.user.email });
    res.json({ success: true, message: 'Updated.', data: updated });
  } catch (err) { next(err); }
};

// DELETE /api/candidates/:id
export const deleteCandidate = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, isDeleted: false };
    if (req.adminScope) query.adminId = req.adminScope;
    const c = await Candidate.findOne(query);
    if (!c) return res.status(404).json({ success: false, message: 'Not found.' });
    c.isDeleted = true; c.deletedAt = new Date();
    await c.save();
    logger.info('Candidate deleted', { app: c.applicationNumber, by: req.user.email });
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) { next(err); }
};

// GET /api/candidates/export/excel
export const exportExcel = async (req, res, next) => {
  try {
    const data = await Candidate.find(adminFilter(req)).sort({ createdAt: -1 }).lean();
    const rows = data.map((c, i) => ({
      'Sr#':              i + 1,
      'Application No':   c.applicationNumber,
      'Identifier Type':  c.identifierType || 'passport',
      'Passport No':      c.passportNumber  || '',
      'Control No':       c.controlNumber   || '',
      'Visa No':          c.visaNumber      || '',
      'Full Name':        c.fullName,
      'Date of Birth':    fmtDate(c.dateOfBirth),
      'Profession':       c.profession      || '',
      'Company':          c.companyName     || '',
      'Visa Issue Date':  fmtDate(c.visaIssueDate),
      'Visa Expiry Date': fmtDate(c.visaExpiryDate),
      'Visa Type':        c.visaType        || '',
      'Country':          c.country,
      'Status':           c.status,
      'Message':          c.message         || '',
      'Applied On':       fmtDate(c.applicationDate),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Candidates');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="candidates-${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
};

// GET /api/candidates/admin/download/:id  — serve visa doc to admin
export const downloadVisa = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, isDeleted: false };
    if (req.adminScope) query.adminId = req.adminScope;
    const c = await Candidate.findOne(query);
    if (!c) return res.status(404).json({ success: false, message: 'Not found.' });
    if (!c.visaDocument || !existsSync(c.visaDocument)) {
      return res.status(404).json({ success: false, message: 'No visa document uploaded.' });
    }
    res.download(c.visaDocument, c.visaDocumentName || `VisaDoc-${c.applicationNumber}`);
  } catch (err) { next(err); }
};

// PUBLIC: POST /api/candidates/public/track
export const trackVisa = async (req, res, next) => {
  try {
    const { identifierType, passportNumber, controlNumber, dateOfBirth } = req.body;
    if (!dateOfBirth || (!passportNumber && !controlNumber)) {
      return res.status(400).json({ success: false, message: 'DOB + passport/control number required.' });
    }
    const dob = new Date(dateOfBirth);
    const orConds = [];
    if (passportNumber?.trim()) orConds.push({ passportNumber: passportNumber.toUpperCase().trim() });
    if (controlNumber?.trim())  orConds.push({ controlNumber:  controlNumber.toUpperCase().trim() });

    const c = await Candidate.findOne({
      $or: orConds,
      dateOfBirth: { $gte: new Date(new Date(dob).setHours(0,0,0,0)), $lte: new Date(new Date(dob).setHours(23,59,59,999)) },
      isDeleted: false,
    });

    if (!c) return res.status(404).json({ success: false, message: 'No record found. Check your details.' });

    const isApproved = c.status === 'Approved' || c.status === 'Issued';

    res.json({
      success: true,
      data: {
        identifierType:    c.identifierType  || 'passport',
        passportNumber:    c.passportNumber,
        controlNumber:     c.controlNumber,
        visaNumber:        c.visaNumber,
        fullName:          c.fullName,
        dateOfBirth:       c.dateOfBirth,
        profession:        c.profession,
        companyName:       c.companyName,
        visaIssueDate:     c.visaIssueDate,
        visaExpiryDate:    c.visaExpiryDate,
        visaType:          c.visaType,
        country:           c.country,
        status:            c.status,
        message:           c.message,
        applicationNumber: c.applicationNumber,
        hasVisaDocument:   isApproved && !!c.visaDocument,
        visaDocumentType:  isApproved ? c.visaDocumentType : null,
        candidateId:       c._id,
      },
    });
  } catch (err) { next(err); }
};

// PUBLIC: GET /api/candidates/public/visa-doc/:id — serve visa doc to public user
export const publicVisaDoc = async (req, res, next) => {
  try {
    const { passportNumber, controlNumber, dateOfBirth } = req.query;
    if (!dateOfBirth || (!passportNumber && !controlNumber)) {
      return res.status(400).json({ success: false, message: 'Verification required.' });
    }
    const dob = new Date(dateOfBirth);
    const orConds = [];
    if (passportNumber?.trim()) orConds.push({ passportNumber: passportNumber.toUpperCase().trim() });
    if (controlNumber?.trim())  orConds.push({ controlNumber:  controlNumber.toUpperCase().trim() });

    const c = await Candidate.findOne({
      _id: req.params.id,
      $or: orConds,
      dateOfBirth: { $gte: new Date(new Date(dob).setHours(0,0,0,0)), $lte: new Date(new Date(dob).setHours(23,59,59,999)) },
      isDeleted: false,
    });

    if (!c || !c.visaDocument || !existsSync(c.visaDocument)) {
      return res.status(404).json({ success: false, message: 'Document not available.' });
    }

    c.downloadLogs.push({ ip: req.ip }); await c.save();

    // Stream file with correct content-type
    const ext = path.extname(c.visaDocument).toLowerCase();
    const mimeTypes = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
    const mime = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${c.visaDocumentName || `visa-doc${ext}`}"`);
    const { createReadStream } = await import('fs');
    createReadStream(c.visaDocument).pipe(res);
  } catch (err) { next(err); }
};