import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

function safeExec(command) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const packageJson = JSON.parse(execSync('cat package.json').toString());
const version = packageJson.version;

const latestTag = safeExec('git describe --tags --abbrev=0');
const range = latestTag
  ? `${latestTag}..HEAD`
  : `${safeExec('git rev-list --max-parents=0 HEAD')}..HEAD`;

const commitLines = safeExec(
  `git log ${range} --pretty=format:"- %s" --no-merges`
);

const changes = commitLines || '- Bug fixes and improvements';

const normalized = changes
  .split('\n')
  .map((line) => line.replace(/^-\s*/, '').trim())
  .filter(Boolean)
  .map((line) => `• ${line}`)
  .join('\n');

const priority = /\b(urgent|security|critical|hotfix)\b/i.test(changes)
  ? 'urgent'
  : 'standard';

const payload = {
  version,
  date: new Date().toISOString().split('T')[0],
  priority,
  changes: normalized || '• Bug fixes and improvements',
};

writeFileSync('public/changelog.json', JSON.stringify(payload, null, 2));
writeFileSync('public/version.json', JSON.stringify(payload, null, 2));

console.log('Generated changelog/version metadata for', version);
