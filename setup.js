#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 HITAM AI Club - Environment Setup\n');

const envTemplate = `# Firebase Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain_here
VITE_FIREBASE_DATABASE_URL=your_firebase_database_url_here
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id_here
VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket_here
VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id_here
VITE_FIREBASE_APP_ID=your_firebase_app_id_here
VITE_FIREBASE_MEASUREMENT_ID=your_firebase_measurement_id_here

# Cloudinary Configuration
VITE_CLOUDINARY_CLOUD_NAME=dwva5ae36
VITE_CLOUDINARY_UPLOAD_PRESET=Hitam_ai
CLOUDINARY_API_KEY=your_cloudinary_api_key_here
CLOUDINARY_API_SECRET=your_cloudinary_api_secret_here
CLOUDINARY_CLOUD_NAME=dwva5ae36

# Server Configuration
PORT=5000
`;

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  console.log('⚠️  .env file already exists. Skipping creation.');
} else {
  fs.writeFileSync(envPath, envTemplate);
  console.log('✅ Created .env file with template variables');
}

console.log('\n📋 Next Steps:');
console.log('1. Update the .env file with your actual Firebase and Cloudinary credentials');
console.log('2. Run "npm run dev:full" to start both frontend and backend');
console.log('3. Access the application at http://localhost:5173');
console.log('4. Access admin panel at http://localhost:5173/admin/login');
console.log('\n📚 For detailed setup instructions, see README.md');
