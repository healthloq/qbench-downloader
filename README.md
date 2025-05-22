# qbench-downloader
Application to download certificates from QBench

This application will perform the following steps:
Read QB_USERNAME and QB_SECRET from a .env file.
Authenticate to the QBench API to obtain a session_id.
Retrieve all certificates generated in the last 24 hours.
For each certificate, retrieve its associated files.
Download these files to a local downloads directory.

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
