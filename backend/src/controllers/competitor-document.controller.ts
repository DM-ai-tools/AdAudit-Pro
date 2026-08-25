import { Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth.js';
import { parseCompetitorsFromDocument } from '../services/competitor-document.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const okExt =
      name.endsWith('.pdf') ||
      name.endsWith('.doc') ||
      name.endsWith('.docx') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls');
    const okMime =
      /pdf|msword|wordprocessingml|officedocument/i.test(file.mimetype) ||
      /spreadsheetml|vnd\.ms-excel/i.test(file.mimetype) ||
      file.mimetype === 'application/octet-stream';
    if (okExt || okMime) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF, DOC, DOCX, and XLSX files are allowed'));
  },
});

export const competitorDocumentUpload = upload.single('file');

export async function handleParseCompetitorDocument(req: AuthRequest, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: 'Upload a PDF, DOC, DOCX, or XLSX file with the field name "file".' });
      return;
    }

    const result = await parseCompetitorsFromDocument({
      buffer: file.buffer,
      filename: file.originalname || 'competitors.pdf',
      mimeType: file.mimetype,
    });

    res.json({
      success: true,
      filename: file.originalname,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse competitor document';
    const status = /unsupported|only pdf|could not read|no competitors/i.test(message) ? 400 : 500;
    console.error('[parse-competitors]', message);
    res.status(status).json({ error: message });
  }
}
