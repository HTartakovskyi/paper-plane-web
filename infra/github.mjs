import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const repo = 'HTartakovskyi/paper-plane-web';
const credential = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
});
const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
if (!token) throw new Error('GitHub credential unavailable');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const [action, arg] = process.argv.slice(2);
if (action === 'status') {
  const data = await api('actions/workflows/lambda-linux.yml/runs?per_page=3');
  console.log(JSON.stringify(data.workflow_runs.map(r => ({ id: r.id, sha: r.head_sha, status: r.status, conclusion: r.conclusion, url: r.html_url }))));
} else if (action === 'jobs') {
  const data = await api(`actions/runs/${arg}/jobs`);
  console.log(JSON.stringify(data.jobs.map(j => ({ id: j.id, status: j.status, conclusion: j.conclusion, steps: j.steps.map(s => ({ name: s.name, status: s.status, conclusion: s.conclusion })) }))));
} else if (action === 'log') {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${arg}/logs`, { headers });
  if (!response.ok) throw new Error(`Logs HTTP ${response.status}`);
  const body = await response.text();
  console.log(body.slice(-16000));
} else if (action === 'dispatch') {
  await api('actions/workflows/lambda-linux.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: arg || 'master' }) });
  console.log('Workflow dispatched');
} else if (action === 'download') {
  const data = await api(`actions/runs/${arg}/artifacts`);
  mkdirSync('.deploy', { recursive: true });
  for (const artifact of data.artifacts) {
    if (artifact.expired) throw new Error('Artifact expired');
    const response = await fetch(artifact.archive_download_url, { headers });
    if (!response.ok) throw new Error(`Artifact HTTP ${response.status}`);
    writeFileSync(`.deploy/${artifact.name}.zip`, Buffer.from(await response.arrayBuffer()));
    console.log(`Downloaded ${artifact.name}`);
  }
} else throw new Error('Use status, dispatch [branch], download RUN_ID');
