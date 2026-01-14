#!/usr/bin/env node

/**
 * 🚀 PRODUCTION DEPLOYMENT SETUP SCRIPT
 * 
 * This script helps you prepare your project for production deployment
 * on Render (backend) + Vercel (frontend)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n🚀 PRODUCTION DEPLOYMENT SETUP\n');
console.log('=========================================\n');

// Check if files exist
const files = [
  { path: '.env', name: 'Environment variables (.env)' },
  { path: '.env.local', name: 'Local dev variables (.env.local)' },
  { path: '.env.production', name: 'Production variables (.env.production)' },
  { path: 'server/index.js', name: 'Backend server (server/index.js)' },
  { path: 'package.json', name: 'Package configuration (package.json)' },
  { path: 'PRODUCTION_DEPLOYMENT_CHECKLIST.md', name: 'Deployment checklist' },
];

console.log('✅ Checking configuration files...\n');

let allGood = true;
files.forEach(file => {
  const filePath = path.join(__dirname, file.path);
  const exists = fs.existsSync(filePath);
  const status = exists ? '✅' : '❌';
  console.log(`${status} ${file.name}`);
  if (!exists) allGood = false;
});

console.log('\n=========================================\n');

if (allGood) {
  console.log('✅ All configuration files found!\n');
} else {
  console.log('❌ Some files are missing. Please check.\n');
  process.exit(1);
}

// Check environment variables
console.log('📋 Checking environment variables...\n');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

const requiredVars = [
  'VITE_API_URL',
  'CLOUDINARY_CLOUD_NAME',
  'VITE_FIREBASE_API_KEY',
];

let varsOk = true;
requiredVars.forEach(varName => {
  if (envContent.includes(varName)) {
    console.log(`✅ ${varName} found`);
  } else {
    console.log(`❌ ${varName} missing`);
    varsOk = false;
  }
});

console.log('\n=========================================\n');

if (varsOk) {
  console.log('✅ All required variables configured!\n');
} else {
  console.log('❌ Some variables are missing. Update .env files.\n');
  process.exit(1);
}

console.log('🎯 NEXT STEPS:\n');
console.log('1. Push code to GitHub');
console.log('   git add .');
console.log('   git commit -m "chore: prepare for production deployment"');
console.log('   git push origin main\n');

console.log('2. Deploy Backend to Render');
console.log('   → https://render.com');
console.log('   → Create new Web Service');
console.log('   → Set FRONTEND_URL=https://hitam-ai-club.vercel.app\n');

console.log('3. Get Backend URL from Render\n');

console.log('4. Deploy Frontend to Vercel');
console.log('   → https://vercel.com');
console.log('   → Import project');
console.log('   → Set VITE_API_URL=<your-render-backend-url>\n');

console.log('5. Test Everything');
console.log('   → Frontend: https://hitam-ai-club.vercel.app');
console.log('   → Backend: https://hitam-ai-club.onrender.com\n');

console.log('📖 Read: PRODUCTION_DEPLOYMENT_CHECKLIST.md\n');

console.log('=========================================\n');
console.log('✅ Setup complete! Ready for production 🚀\n');
