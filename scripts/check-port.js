#!/usr/bin/env node
import { execSync } from 'child_process';

const PORT = Number(process.argv[2] || 5173);
const shouldKill = process.argv.includes('--kill');

function listHolders(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    const lines = out.trim().split('\n').slice(1);
    return lines.map(line => {
      const parts = line.split(/\s+/);
      return { command: parts[0], pid: Number(parts[1]), name: parts.slice(8).join(' ') };
    });
  } catch {
    return [];
  }
}

const holders = listHolders(PORT);

if (holders.length === 0) {
  process.exit(0);
}

console.error(`\n\u26a0\ufe0f  포트 ${PORT} 이 이미 사용 중입니다:\n`);
for (const h of holders) {
  console.error(`   PID ${h.pid}  ${h.command}  (${h.name})`);
}

if (!shouldKill) {
  console.error(`\n   해결 방법:`);
  console.error(`     1) 위 PID 를 직접 종료:  kill ${holders.map(h => h.pid).join(' ')}`);
  console.error(`     2) 자동 종료 후 재실행:   npm run dev:force\n`);
  process.exit(1);
}

const pids = [...new Set(holders.map(h => h.pid))];
console.error(`\n\ud83d\udd2a  유령 프로세스 종료 중: ${pids.join(', ')}`);
try {
  execSync(`kill ${pids.join(' ')}`);
} catch (e) {
  console.error(`   kill 실패, SIGKILL 시도...`);
  execSync(`kill -9 ${pids.join(' ')}`);
}

await new Promise(r => setTimeout(r, 500));

const remaining = listHolders(PORT);
if (remaining.length > 0) {
  console.error(`\n\u274c  여전히 포트 ${PORT} 점유 중. 수동으로 처리하세요.`);
  process.exit(1);
}
console.error(`\u2705  포트 ${PORT} 정리 완료\n`);
