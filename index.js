import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import dayjs from 'dayjs';
import crypto from 'crypto';
import { URLSearchParams } from 'url';

dotenv.config();

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const { QB_USERNAME, QB_SECRET, QB_DAYS_BACK = 30, DOWNLOAD_DIR, BASE_URL } = process.env;

if (!QB_USERNAME || !QB_SECRET || !DOWNLOAD_DIR || !BASE_URL) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const LOG_FILE = path.join(DOWNLOAD_DIR, 'download_log.json');

// ---------------------------------------------------------------------------
// Token Handling With Auto-Refresh
// ---------------------------------------------------------------------------

let cachedToken = null;
let tokenExpiresAt = null;

async function getAccessToken() {
  const payload = { sub: QB_USERNAME };
  const token = jwt.sign(payload, QB_SECRET, { algorithm: 'HS256', expiresIn: '5m' });

  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.append('assertion', token);

  const { data } = await axios.post(`${BASE_URL}/auth/token`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  return data.access_token;
}

async function getValidToken() {
  if (!cachedToken || !tokenExpiresAt || Date.now() >= tokenExpiresAt) {
    cachedToken = await getAccessToken();
    tokenExpiresAt = Date.now() + 4 * 60 * 1000; // refresh every 4 min
    console.log("🔄 Refreshed access token");
  }
  return cachedToken;
}

// ---------------------------------------------------------------------------
// Auth Request Wrapper with Token Refresh & Rate Limit Logic
// ---------------------------------------------------------------------------

async function authRequest(config) {
  while (true) {
    try {
      const token = await getValidToken();
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
      return await axios(config);

    } catch (err) {
      const data = err?.response?.data;

      const isExpired = data?.error_description === "Access token has expired.";
      const isRateLimit =
        data?.error_type === "RateLimitError" ||
        (data?.error_description || "").toLowerCase().includes("ratelimit");

      if (isExpired) {
        console.log("🔄 Token expired — refreshing & retrying");
        cachedToken = null;
        continue;
      }

      if (isRateLimit) {
        let waitSeconds = 10;
        const match = (data.error_description || "").match(/retry in (\d+) seconds?/i);
        if (match) waitSeconds = parseInt(match[1], 10);

        console.warn(`⏳ Rate limit hit — waiting ${waitSeconds}s then retrying...`);
        await new Promise(res => setTimeout(res, waitSeconds * 1000));
        continue;
      }

      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Report API — Page Number Pagination
// ---------------------------------------------------------------------------

async function fetchReportPage(dateFrom, pageNumber) {
  const params = {
    created_after: dateFrom,
    page_size: 50,
    page_num: pageNumber
  };

  const { data } = await authRequest({
    method: 'GET',
    url: `${BASE_URL}/reports`,
    params
  });

  if (!Array.isArray(data?.data)) {
    console.error('Unexpected reports response:', data);
    throw new Error('Reports data is not an array');
  }

  return {
    reports: data.data,
    pageNumber: data.page_number,
    totalPages: data.total_pages,
    totalCount: data.total_count || null
  };
}

async function getReportDetail(reportId) {
  const { data } = await authRequest({
    method: 'GET',
    url: `${BASE_URL}/reports/${reportId}`
  });
  return data;
}

// ---------------------------------------------------------------------------
// File Utilities
// ---------------------------------------------------------------------------

async function downloadFileStream(url, destinationPath) {
  await fs.ensureDir(path.dirname(destinationPath));
  const writer = fs.createWriteStream(destinationPath);
  const response = await axios.get(url, { responseType: 'stream' });
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(destinationPath));
    writer.on('error', reject);
  });
}

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ---------------------------------------------------------------------------
// Download Log
// ---------------------------------------------------------------------------

function readDownloadLog() {
  if (!fs.existsSync(LOG_FILE)) return {};
  return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
}

function writeDownloadLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Report Processing
// ---------------------------------------------------------------------------

async function processReport(report, downloadLog) {
  const reportId = report.id;
  const detail = await getReportDetail(reportId);
  const fileUrl = detail?.data?.url;

  if (!fileUrl) {
    console.warn(`⚠️ No file URL for report ${reportId}`);
    return false;
  }

  const filename = `report_${reportId}.pdf`;
  const finalPath = path.join(DOWNLOAD_DIR, filename);
  const tempPath = path.join(DOWNLOAD_DIR, `.tmp_${filename}`);

  // skip unchanged
  if (fs.existsSync(finalPath)) {
    const existingHash = await calculateFileHash(finalPath);
    if (downloadLog[reportId]?.hash === existingHash) {
      console.log(`⏭️ Skipping unchanged report ${reportId}`);
      return false;
    }
  }

  // download → hash → move
  await downloadFileStream(fileUrl, tempPath);
  const newHash = await calculateFileHash(tempPath);
  fs.renameSync(tempPath, finalPath);

  downloadLog[reportId] = {
    filename,
    hash: newHash,
    downloaded_at: new Date().toISOString()
  };

  console.log(`⬇️ Downloaded report ${reportId} → ${filename}`);
  return true;
}

// ---------------------------------------------------------------------------
// Main — Page-Number Pagination Loop
// ---------------------------------------------------------------------------

async function main() {
  try {
    console.log("🔐 Authenticating...");
    await getValidToken();

    const downloadLog = readDownloadLog();
    const downloadedIds = new Set(Object.keys(downloadLog));
    const dateFrom = dayjs().subtract(QB_DAYS_BACK, 'day').format('YYYY-MM-DD');

    let pageNumber = 1;
    let totalPages = null;
    let totalReports = null;
    let totalDownloaded = 0;

    console.log("ℹ️ Using page-number pagination.");

    // Loop until reaching total_pages
    while (true) {
      const page = await fetchReportPage(dateFrom, pageNumber);

      if (totalPages === null) totalPages = page.totalPages;
      if (totalReports === null && page.totalCount) totalReports = page.totalCount;

      console.log(`📄 Page ${page.pageNumber}/${page.totalPages}: fetched ${page.reports.length} reports`);

      // process all reports
      for (const report of page.reports) {
        const idStr = report.id.toString();

        if (downloadedIds.has(idStr)) {
          console.log(`⏭️ Skipping unchanged report ${report.id}`);
          continue;
        }

        const downloaded = await processReport(report, downloadLog);
        if (downloaded) {
          downloadedIds.add(idStr);
          totalDownloaded++;
        }
      }

      writeDownloadLog(downloadLog);

      const progressMsg = totalReports
        ? `ℹ️ Progress: ${totalDownloaded}/${totalReports} (${((totalDownloaded / totalReports) * 100).toFixed(1)}%)`
        : `ℹ️ Progress: ${totalDownloaded} reports downloaded`;

      console.log(progressMsg);

      // Stop when we reach final page
      if (page.pageNumber >= page.totalPages) {
        console.log("ℹ️ No more pages — finished.");
        break;
      }

      pageNumber++;
    }

    console.log(`✅ All reports processed successfully. Total downloaded: ${totalDownloaded}`);

  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message || err);
  }
}

main();
