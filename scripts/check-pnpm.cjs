const fs = require('node:fs');
const path = require('node:path');

const pnpmInvocation = [process.env.npm_config_user_agent, process.env.npm_execpath]
  .some((value) => String(value || '').toLowerCase().includes('pnpm'));
if (!pnpmInvocation) {
  console.error('Use pnpm instead');
  process.exit(1);
}

for (const filename of ['package-lock.json', 'yarn.lock']) {
  const target = path.join(__dirname, '..', filename);
  if (fs.existsSync(target)) fs.rmSync(target);
}

