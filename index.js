// index.js
require('dotenv').config(); // Load environment variables from .env
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const QB_USERNAME = process.env.QB_USERNAME;
const QB_SECRET = process.env.QB_SECRET;
const BASE_API_URL = 'https://api.qbench.com/v2';
const DOWNLOAD_DIR = 'downloads';

// --- Axios Instance for QBench API Calls ---
const api = axios.create({
    baseURL: BASE_API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// --- Helper function to ensure download directory exists ---
const ensureDownloadDir = () => {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        console.log(`Created download directory: ./${DOWNLOAD_DIR}`);
    }
};

// --- Main Application Logic ---
async function main() {
    if (!QB_USERNAME || !QB_SECRET) {
        console.error('Error: QB_USERNAME and QB_SECRET must be set in the .env file.');
        process.exit(1);
    }

    let sessionId = null;

    try {
        // 1. Authenticate to the API
        console.log('Authenticating to QBench API...');
        const authResponse = await api.post('/authenticate', {
            username: QB_USERNAME,
            secret: QB_SECRET,
        });

        sessionId = authResponse.data.session_id;
        console.log('Authentication successful. Session ID obtained.');

        // Set the Authorization header for all subsequent requests
        api.defaults.headers.common['Authorization'] = `Bearer ${sessionId}`;

        // 2. Calculate dates for the last 24 hours
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours in milliseconds

        const fromDate = twentyFourHoursAgo.toISOString(); // QBench expects ISO 8601 format
        const toDate = now.toISOString();

        console.log(`Retrieving certificates generated between ${fromDate} and ${toDate}...`);

        // 3. Get list of certificates generated in the last 24 hours
        const certificatesResponse = await api.get('/certificates', {
            params: {
                from_date: fromDate,
                to_date: toDate,
            },
        });

        const certificates = certificatesResponse.data;
        console.log(`Found ${certificates.length} certificates generated in the last 24 hours.`);

        if (certificates.length === 0) {
            console.log('No certificates found for the specified period. Exiting.');
            return;
        }

        // Ensure download directory exists
        ensureDownloadDir();

        // 4. Download files for each certificate
        for (const cert of certificates) {
            console.log(`\nProcessing certificate ID: ${cert.id}`);

            try {
                // Get files associated with this certificate
                const filesResponse = await api.get('/files', {
                    params: {
                        resource_type: 'certificate',
                        resource_id: cert.id,
                        // You can add 'limit' or 'offset' here if a certificate might have many files
                    },
                });

                const files = filesResponse.data;
                console.log(`  Found ${files.length} files for certificate ID ${cert.id}`);

                if (files.length === 0) {
                    console.log(`  No files found for certificate ID ${cert.id}.`);
                    continue;
                }

                for (const file of files) {
                    console.log(`    Downloading file ID: ${file.id}, Name: ${file.file_name}`);

                    try {
                        // It's good practice to get file details first to ensure the filename is accurate
                        // Though the list endpoint already gives file_name, this confirms it.
                        // const fileDetailsResponse = await api.get(`/files/${file.id}`);
                        // const actualFileName = fileDetailsResponse.data.file_name;

                        const downloadResponse = await api.get(`/files/${file.id}/download`, {
                            responseType: 'stream', // Important for downloading binary data
                        });

                        const filePath = path.join(DOWNLOAD_DIR, `${cert.id}_${file.file_name}`);
                        const writer = fs.createWriteStream(filePath);

                        downloadResponse.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });

                        console.log(`      Successfully downloaded: ${filePath}`);

                    } catch (fileError) {
                        console.error(`      Error downloading file ID ${file.id} for certificate ${cert.id}:`,
                            fileError.response ? fileError.response.data : fileError.message);
                    }
                }
            } catch (certFilesError) {
                console.error(`  Error retrieving files for certificate ID ${cert.id}:`,
                    certFilesError.response ? certFilesError.response.data : certFilesError.message);
            }
        }

        console.log('\nAll relevant files processed.');

    } catch (error) {
        console.error('An error occurred during the process:');
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('  Status:', error.response.status);
            console.error('  Headers:', error.response.headers);
            console.error('  Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            // The request was made but no response was received
            console.error('  No response received:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('  Error message:', error.message);
        }
        process.exit(1); // Exit with an error code
    } finally {
        // Optional: Invalidate session if needed, though QBench sessions usually expire automatically
        // No explicit logout endpoint found in Swagger, so we'll just let it expire.
    }
}

// Run the main function
main(); 