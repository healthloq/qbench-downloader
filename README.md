# qbench-downloader
Application to download certificates from QBench

This application will perform the following steps:
Read QB_USERNAME and QB_SECRET from a .env file.
Authenticate to the QBench API to obtain a session_id.
Retrieve all certificates generated in the last 24 hours.
For each certificate, retrieve its associated files.
Download these files to a local downloads directory.

QBench API is found at:
https://app.swaggerhub.com/apis/INTEGRATIONS_8/QBench-API-v2/2.0

Prerequisites:
Make sure you have Node.js and npm installed.

Step 1: Set up your project directory
Create a new directory for your project and navigate into it:
mkdir qbench-downloader
cd qbench-downloader

Step 2: Initialize npm and install dependencies
npm init -y
npm install axios dotenv

Step 3: Create your .env file
Create a file named .env in the root of your project directory:
# .env
QB_USERNAME=your_qbench_username
QB_SECRET=your_qbench_api_secret


Explanation:
.env Loading: require('dotenv').config(); at the very top loads your environment variables, making them accessible via process.env.
Axios Setup:
An axios instance (api) is created with the BASE_API_URL and default Content-Type header.
After successful authentication, the session_id is added as a Bearer token to the Authorization header for all subsequent requests made with this api instance. This is the standard way to handle API key or token-based authentication.
Authentication (/authenticate):
It makes a POST request to the /authenticate endpoint with username and secret in the request body.
The session_id from the response is extracted.
Date Calculation:
new Date() is used to get the current time.
new Date(now.getTime() - 24 * 60 * 60 * 1000) calculates the time 24 hours ago.
.toISOString() converts these Date objects into the ISO 8601 string format required by the QBench API for from_date and to_date parameters.
Get Certificates (/certificates):
A GET request is made to /certificates.
The from_date and to_date are passed as params (query parameters).
The response contains an array of certificate objects.
Download Directory (downloads):
ensureDownloadDir() checks if the downloads folder exists and creates it if it doesn't, using fs.mkdirSync({ recursive: true }) for robustness.
Iterate and Download Files (/files, /files/{file_id}/download):
The code iterates through each certificate found.
For each certificate, it makes a GET request to /files with resource_type: 'certificate' and resource_id: cert.id to get a list of files specifically attached to that certificate.
Then, it iterates through each file associated with the certificate.
A GET request is made to /files/{file.id}/download.
Crucially, responseType: 'stream' is used for the download request. This tells Axios to return the response as a Node.js readable stream, which is efficient for binary data like files.
downloadResponse.data.pipe(writer) pipes the incoming stream directly to a fs.createWriteStream, which writes the data to a local file.
A Promise is used to await the completion of the file writing process (writer.on('finish', resolve)).
The downloaded file is saved with a name like certificateId_originalFileName.ext to prevent conflicts if multiple certificates have files with identical names.
Error Handling: Comprehensive try...catch blocks are included at various levels to catch network errors, API errors (checking error.response), and file system errors, providing informative messages to the console.
