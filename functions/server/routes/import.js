'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const importController = require('../controllers/importController');

// Configure multer to store file in memory
const storage = multer.memoryStorage();
const upload = multer({
	storage: storage,
	limits: {
		fileSize: 200 * 1024 * 1024 // 200MB limit
	},
	fileFilter: (req, file, cb) => {
		// Accept Excel files
		if (
			file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
			file.mimetype === 'application/vnd.ms-excel' ||
			file.mimetype === 'application/vnd.ms-excel.sheet.binary.macroEnabled.12' ||
			file.originalname.endsWith('.xlsx') ||
			file.originalname.endsWith('.xls') ||
			file.originalname.endsWith('.xlsb')
		) {
			cb(null, true);
		} else {
			cb(new Error('Only Excel files (.xlsx, .xls, .xlsb) are allowed'), false);
		}
	}
});

// POST /api/import/excel -> import Excel file
router.post('/excel', upload.single('file'), importController.importExcel);

// GET /api/import/progress/:id -> current progress
router.get('/progress/:id', importController.getImportProgress);

// GET /api/import/test -> test database insertion with dummy data
router.get('/test', importController.testInsert);

module.exports = router;

