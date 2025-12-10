#!/usr/bin/env node

/**
 * KChat Passkey Registration Fix Script
 * 
 * This script addresses common issues that cause 500 errors during passkey registration:
 * 1. Environment variable validation
 * 2. Database connectivity checks
 * 3. WebAuthn configuration validation
 * 4. Dependency verification
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 KChat Passkey Registration Fix Script');
console.log('==========================================\n');

// Check if we're in the right directory
if (!fs.existsSync('package.json')) {
  console.error('❌ Error: package.json not found. Please run this script from the project root.');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log(`📦 Project: ${packageJson.name} v${packageJson.version}\n`);

// 1. Environment Variable Validation
console.log('1️⃣ Checking Environment Variables...');

const requiredEnvVars = ['DATABASE_URL', 'RP_ID', 'ORIGIN', 'JWT_SECRET'];
const envFile = '.env';
let envVars = {};

if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      envVars[key.trim()] = value.trim();
    }
  });
} else {
  console.log('⚠️  .env file not found, checking process.env...');
  envVars = process.env;
}

let envIssues = [];
requiredEnvVars.forEach(varName => {
  if (!envVars[varName]) {
    envIssues.push(varName);
  } else {
    console.log(`✅ ${varName}: ${varName === 'JWT_SECRET' ? '[HIDDEN]' : envVars[varName]}`);
  }
});

if (envIssues.length > 0) {
  console.log(`❌ Missing environment variables: ${envIssues.join(', ')}`);
  
  // Create a sample .env file
  const sampleEnv = `# KChat Environment Configuration
DATABASE_URL=file:./db/custom.db
RP_ID=localhost
ORIGIN=http://localhost:3000
JWT_SECRET=${require('crypto').randomBytes(32).toString('base64')}
NODE_ENV=development
PORT=3000
`;
  
  fs.writeFileSync('.env.example', sampleEnv);
  console.log('📝 Created .env.example file with sample configuration');
} else {
  console.log('✅ All required environment variables are set\n');
}

// 2. Database Connectivity Check
console.log('2️⃣ Checking Database Configuration...');

const dbUrl = envVars.DATABASE_URL || process.env.DATABASE_URL;
if (dbUrl) {
  if (dbUrl.startsWith('file:')) {
    const dbPath = dbUrl.replace('file:', '');
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      console.log(`📁 Creating database directory: ${dbDir}`);
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    if (fs.existsSync(dbPath)) {
      console.log(`✅ Database file exists: ${dbPath}`);
    } else {
      console.log(`⚠️  Database file not found: ${dbPath}`);
      console.log('   Run: npx prisma db push');
    }
  } else {
    console.log(`✅ Database URL configured: ${dbUrl.split('@')[0]}@[HIDDEN]`);
  }
} else {
  console.log('❌ DATABASE_URL not configured');
}

// 3. WebAuthn Configuration Validation
console.log('\n3️⃣ Validating WebAuthn Configuration...');

const rpId = envVars.RP_ID || process.env.RP_ID;
const origin = envVars.ORIGIN || process.env.ORIGIN;

if (rpId && origin) {
  // Validate RP_ID format
  if (rpId === 'localhost' || rpId.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
    console.log(`✅ RP_ID format valid: ${rpId}`);
  } else {
    console.log(`❌ RP_ID format invalid: ${rpId}`);
    console.log('   RP_ID should be a domain (e.g., example.com) or "localhost"');
  }
  
  // Validate ORIGIN format
  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    console.log(`✅ ORIGIN format valid: ${origin}`);
  } else {
    console.log(`❌ ORIGIN format invalid: ${origin}`);
    console.log('   ORIGIN should start with http:// or https://');
  }
  
  // Check RP_ID and ORIGIN compatibility
  const originDomain = origin.replace(/^https?:\/\//, '').split(':')[0];
  if (rpId === originDomain || rpId === 'localhost') {
    console.log('✅ RP_ID and ORIGIN are compatible');
  } else {
    console.log(`⚠️  RP_ID (${rpId}) and ORIGIN domain (${originDomain}) mismatch`);
    console.log('   This may cause WebAuthn failures');
  }
} else {
  console.log('❌ WebAuthn configuration incomplete');
}

// 4. Dependency Check
console.log('\n4️⃣ Checking Critical Dependencies...');

const criticalDeps = [
  '@simplewebauthn/server',
  '@simplewebauthn/browser',
  '@prisma/client',
  'tweetnacl',
  'libsodium-wrappers'
];

let missingDeps = [];
criticalDeps.forEach(dep => {
  if (packageJson.dependencies[dep] || packageJson.devDependencies?.[dep]) {
    console.log(`✅ ${dep}: ${packageJson.dependencies[dep] || packageJson.devDependencies[dep]}`);
  } else {
    missingDeps.push(dep);
  }
});

if (missingDeps.length > 0) {
  console.log(`❌ Missing dependencies: ${missingDeps.join(', ')}`);
  console.log('   Run: npm install');
} else {
  console.log('✅ All critical dependencies are installed');
}

// 5. Generate Debug Script
console.log('\n5️⃣ Creating Debug Script...');

const debugScript = `#!/usr/bin/env node

// KChat Registration Debug Script
const { PrismaClient } = require('@prisma/client');

async function debugRegistration() {
  console.log('🔍 KChat Registration Debug');
  console.log('===========================\\n');
  
  // Environment check
  console.log('Environment Variables:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- DATABASE_URL:', process.env.DATABASE_URL ? '[SET]' : '[NOT SET]');
  console.log('- RP_ID:', process.env.RP_ID || '[NOT SET]');
  console.log('- ORIGIN:', process.env.ORIGIN || '[NOT SET]');
  console.log('- JWT_SECRET:', process.env.JWT_SECRET ? '[SET]' : '[NOT SET]');
  console.log();
  
  // Database connectivity
  console.log('Database Connectivity:');
  try {
    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('✅ Database connection successful');
    
    // Test user query
    const userCount = await prisma.user.count();
    console.log(\`✅ User table accessible (count: \${userCount})\`);
    
    await prisma.$disconnect();
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
  }
  console.log();
  
  // WebAuthn modules
  console.log('WebAuthn Modules:');
  try {
    require('@simplewebauthn/server');
    console.log('✅ @simplewebauthn/server loaded');
  } catch (error) {
    console.log('❌ @simplewebauthn/server failed:', error.message);
  }
  
  try {
    require('tweetnacl');
    console.log('✅ tweetnacl loaded');
  } catch (error) {
    console.log('❌ tweetnacl failed:', error.message);
  }
  
  try {
    require('libsodium-wrappers');
    console.log('✅ libsodium-wrappers loaded');
  } catch (error) {
    console.log('❌ libsodium-wrappers failed:', error.message);
  }
}

debugRegistration().catch(console.error);
`;

fs.writeFileSync('debug-registration.js', debugScript);
fs.chmodSync('debug-registration.js', '755');
console.log('✅ Created debug-registration.js script');

// 6. Summary and Recommendations
console.log('\n📋 Summary and Recommendations:');
console.log('================================');

if (envIssues.length > 0) {
  console.log('🔧 Fix environment variables:');
  console.log('   1. Copy .env.example to .env');
  console.log('   2. Update values for your environment');
  console.log('   3. Ensure RP_ID matches your domain');
}

if (missingDeps.length > 0) {
  console.log('🔧 Install missing dependencies:');
  console.log('   npm install');
}

console.log('🔧 Test the fixes:');
console.log('   1. Run: node debug-registration.js');
console.log('   2. Start the app: npm run dev');
console.log('   3. Try registration again');
console.log('   4. Check logs for detailed error messages');

console.log('\n🚀 Common Solutions:');
console.log('- Ensure database is initialized: npx prisma db push');
console.log('- Verify WebAuthn works in HTTPS (production) or localhost (dev)');
console.log('- Check browser console for client-side errors');
console.log('- Review server logs for detailed error information');

console.log('\n✅ Fix script completed!');