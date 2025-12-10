#!/usr/bin/env node

// KChat Registration Debug Script
const { PrismaClient } = require('@prisma/client');

async function debugRegistration() {
  console.log('🔍 KChat Registration Debug');
  console.log('===========================\n');
  
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
    console.log(`✅ User table accessible (count: ${userCount})`);
    
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
