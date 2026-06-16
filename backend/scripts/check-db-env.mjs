import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const line = readFileSync('.env', 'utf8')
  .split('\n')
  .find((l) => l.trimStart().startsWith('DATABASE_URL'));

console.log('DATABASE_URL line found:', !!line);
if (line) {
  console.log('Has surrounding quotes:', /^DATABASE_URL\s*=\s*["']/.test(line));
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('ERROR: DATABASE_URL not loaded from .env');
  process.exit(1);
}

try {
  const parsed = new URL(url);
  const pwd = decodeURIComponent(parsed.password);
  const special = /[^a-zA-Z0-9._~-]/.test(pwd);
  console.log('Scheme:', parsed.protocol);
  console.log('Host:', parsed.hostname);
  console.log('Port:', parsed.port || '5432');
  console.log('User:', parsed.username);
  console.log('Database:', parsed.pathname.replace(/^\//, ''));
  console.log('Password length:', pwd.length);
  if (special && !parsed.password.includes('%')) {
    console.log('WARNING: password contains special characters — URL-encode them in DATABASE_URL');
    console.log('Example: p@ss#word → p%40ss%23word');
  }
} catch (err) {
  console.log('ERROR: invalid DATABASE_URL format:', err.message);
  process.exit(1);
}
