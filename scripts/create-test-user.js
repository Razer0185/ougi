'use strict';

const path = require('path');
const users = require('../website/users');
const subs = require('../src/utils/subscriptions');

const EMAIL = 'test@ougi.local';
const PASSWORD = 'OugiTest12345';
const NAME = 'Ougi Tester';
const DISCORD = 'ougi_tester';

async function main() {
  users.ensure();
  let user = users.findByEmail(EMAIL);
  if (user) {
    const bcrypt = require('bcryptjs');
    const data = JSON.parse(
      require('fs').readFileSync(path.join(__dirname, '..', 'data', 'users.json'), 'utf8')
    );
    data.users[user.id].passwordHash = await bcrypt.hash(PASSWORD, 12);
    data.users[user.id].name = NAME;
    data.users[user.id].discord = DISCORD;
    require('fs').writeFileSync(
      path.join(__dirname, '..', 'data', 'users.json'),
      JSON.stringify(data, null, 2),
      { mode: 0o600 }
    );
    user = users.getById(user.id);
    console.log('Updated existing test user.');
  } else {
    user = await users.register({
      email: EMAIL,
      password: PASSWORD,
      name: NAME,
      discord: DISCORD,
    });
    console.log('Created test user.');
  }

  // Default test account = License Monthly so the desktop app can Start on PC
  subs.grantFromPayment({
    userId: user.id,
    planId: 'pc',
    planName: 'License Monthly',
    orderId: `test-pc-${Date.now()}`,
    email: EMAIL,
  });

  console.log('');
  console.log('=== Ougi test login (website + OugiHost.exe) ===');
  console.log('Email:    ' + EMAIL);
  console.log('Password: ' + PASSWORD);
  console.log('Plan:     License Monthly ($10 — PC, no cloud host)');
  console.log('App:      OugiHost.exe  →  Log in  →  Dev grant / Start on PC');
  console.log('Web:      http://127.0.0.1:5050/account.html');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
