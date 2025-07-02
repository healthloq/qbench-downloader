import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import dayjs from 'dayjs';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

dotenv.config();

const { QB_USERNAME, QB_SECRET, QB_DAYS_BACK, DOWNLOAD_DIR } = process.env;
const LOG_FILE = path.join(DOWNLOAD_DIR, 'download_log.json');
const BASE_URL = 'https://alkemist-sandbox.qbench.net/qbench/api/v2';


if (!QB_USERNAME || !QB_SECRET || !DOWNLOAD_DIR) {
  console.error('Missing required environment variables.');
  process.exit(1);
}


async function getAccessToken() {
  const payload = {
    sub: QB_USERNAME
  };

  const token = jwt.sign(payload, QB_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m'
  });

  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.append('assertion', token);

  const response = await axios.post(`${BASE_URL}/auth/token`, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  return response.data.access_token;
}



async function getRecentReports(token) {
  const dateFrom = dayjs().subtract(QB_DAYS_BACK, 'day').format('YYYY-MM-DD');

  const response = await axios.get(`${BASE_URL}/reports`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      created_after: dateFrom
    }
  });

  const reports = response.data?.data;

  if (!Array.isArray(reports)) {
    console.error('⚠️ Unexpected reports response:', response.data);
    throw new Error('Reports data is not an array');
  }

  return reports;
}

async function getReportDetail(token, reportId) {
  const response = await axios.get(`${BASE_URL}/reports/${reportId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log(`📦 Report ${reportId} detail:`, response.data); 

  return response.data;
}


async function downloadFile(fileUrl, filename) {
  const response = await axios.get(fileUrl, { responseType: 'stream' });

  await fs.ensureDir(DOWNLOAD_DIR);
  const filePath = path.join(DOWNLOAD_DIR, filename);

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
  });
}


function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}


function loadDownloadLog() {
  if (!fs.existsSync(LOG_FILE)) return {};
  return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
}

function saveDownloadLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}


async function main() {
  try {
    const token = await getAccessToken();
    console.log('✅ Authenticated successfully');

    const reports = await getRecentReports(token);
    console.log(`📄 Found ${reports.length} reports from the specified timeframe`);


    const downloadLog = loadDownloadLog();

    for (const report of reports) {
      const reportId = report.id;
      const detail = await getReportDetail(token, reportId);

      const fileUrl = detail?.data?.url;
      const filename = `report_${reportId}.pdf`;
      const fullPath = path.join(DOWNLOAD_DIR, filename);

      if (!fileUrl) {
        console.warn(`⚠️  No file URL found for report ID ${reportId}`);
        continue;
      }

      const tempPath = path.join(DOWNLOAD_DIR, `.tmp_${filename}`);

      // If file exists, check hash
      if (fs.existsSync(fullPath)) {
        const existingHash = await getFileHash(fullPath);
        if (downloadLog[reportId]?.hash === existingHash) {
          console.log(`✅ Skipping unchanged file for report ${reportId}`);
          continue;
        }
      }

      // Download to temporary file
      const writer = fs.createWriteStream(tempPath);
      const response = await axios.get(fileUrl, { responseType: 'stream' });
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const downloadedHash = await getFileHash(tempPath);

      // Move temp to final path
      fs.renameSync(tempPath, fullPath);

      // Update log
      downloadLog[reportId] = {
        filename,
        hash: downloadedHash,
        downloaded_at: new Date().toISOString()
      };

      console.log(`⬇️  Downloaded and saved: ${filename}`);
    }

    saveDownloadLog(downloadLog);



  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}


main();
