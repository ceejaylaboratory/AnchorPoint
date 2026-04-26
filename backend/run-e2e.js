#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Running AnchorPoint E2E Test Suite');
console.log('=====================================\n');

// Build the project first
console.log('📦 Building TypeScript...');
try {
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ Build successful\n');
} catch (error) {
  console.log('❌ Build failed, but continuing with tests...\n');
}

// Start Docker services
console.log('🐳 Starting Docker services...');
try {
  execSync('docker-compose up -d', { stdio: 'inherit', cwd: path.join(__dirname, '..', '..') });
  console.log('✅ Docker services started\n');
} catch (error) {
  console.log('⚠️  Docker services may not be available\n');
}

// Run the E2E test with Node directly
console.log('🧪 Running E2E tests...');
try {
  execSync('node dist/test/e2e.test.js', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' }
  });
  console.log('\n✅ All E2E tests passed!');
} catch (error) {
  console.log('\n❌ E2E tests failed');
  process.exit(1);
}