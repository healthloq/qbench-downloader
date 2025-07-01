import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import dayjs from 'dayjs';

dotenv.config();

const { QB_USERNAME, QB_SECRET, DOWNLOAD_DIR } = process.env;

if (!QB_USERNAME || !QB_SECRET || !DOWNLOAD_DIR) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const BASE_URL = 'https://alkemist-sandbox.qbench.net/qbench/api/v2';

import { URLSearchParams } from 'url';

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
  const dateFrom = dayjs().subtract(30, 'day').format('YYYY-MM-DD');

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

  console.log(`📦 Report ${reportId} detail:`, response.data); // <-- ADD THIS

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

async function main() {
  try {
    const token = await getAccessToken();
    console.log('✅ Authenticated successfully');

    const reports = await getRecentReports(token);
    console.log(`📄 Found ${reports.length} reports from the last 30 days`);


    for (const report of reports) {
      const reportId = report.id;
      const detail = await getReportDetail(token, reportId);

      const fileUrl = detail?.data?.url;
      const filename = `report_${reportId}.pdf`;

      if (fileUrl) {
        const filePath = await downloadFile(fileUrl, filename);
        console.log(`⬇️  Downloaded ${filename} to ${filePath}`);
      } else {
        console.warn(`⚠️  No document URL found for report ID ${reportId}`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

main();
