import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../src/db/client.js';
import { env } from '../src/config/env.js';

async function ensureAdminAccount() {
  const username = 'dev-admin';
  const password = 'P@ssw0rd123!';

  const found = await query('SELECT id, username FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
  if (found.rows.length) {
    console.log('Found existing account:', found.rows[0]);
    return { id: found.rows[0].id, username };
  }

  const hash = await bcrypt.hash(password, 12);
  const insert = await query(
    `INSERT INTO accounts (full_name, email, username, password_hash, role)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    ['Dev Automation', 'dev-admin@example.local', username, hash, 'Admin']
  );

  console.log('Created admin account. username=%s password=%s', username, password);
  return { id: insert.rows[0].id, username, password };
}

async function findViolationId() {
  const res = await query('SELECT id FROM violations LIMIT 1');
  if (res.rows.length) return res.rows[0].id;
  return null;
}

async function main() {
  try {
    const acct = await ensureAdminAccount();
    const violationId = await findViolationId();

    if (!violationId) {
      console.error('No violations found in database to attach an appeal to.');
      process.exit(2);
    }

    // Generate a short-lived JWT for the account
    const token = jwt.sign({ sub: acct.id, role: 'Admin', username: acct.username }, env.JWT_SECRET, {
      expiresIn: 60 * 60
    });

    const backendUrl = process.env.BACKEND_BASE_URL || `http://localhost:${env.PORT || 3000}`;
    console.log('Using backend URL:', backendUrl);

    const payload = {
      violationId,
      appealText: 'Automated test appeal created by submitTestAppeal script.'
    };

    const resp = await fetch(`${backendUrl}/api/appeals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const body = await resp.text();
    console.log('Response status:', resp.status);
    console.log('Response body:', body);
    if (resp.status >= 200 && resp.status < 300) {
      console.log('Appeal created successfully.');
      process.exit(0);
    }

    console.error('Failed to create appeal; status', resp.status);
    process.exit(3);
  } catch (error) {
    console.error('ERROR', error && (error.stack || error.message || error));
    process.exit(1);
  }
}

main();
