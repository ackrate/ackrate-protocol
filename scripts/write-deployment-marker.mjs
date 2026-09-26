import fs from 'node:fs/promises';
const sha=process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Missing or invalid build revision');
const config=JSON.parse(await fs.readFile('.vercel/output/config.json','utf8'));
if(config.version!==3)throw Error('Unexpected Vercel build output');
await fs.mkdir('.vercel/output/static',{recursive:true});
await fs.writeFile('.vercel/output/static/__deployment.json',JSON.stringify({sha})+'\n');
