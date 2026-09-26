// Project-only fallback for vercel/vercel#17506. The CLI's team metadata lookup
// rejects project tokens, although the project and its environment are accessible.
// Match the cache format used by Vercel CLI; keep normal `vercel pull` first in CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function pullProject({target,env=process.env,fetchImpl=fetch,outDir='.vercel'}){
  if(!['preview','production'].includes(target))throw Error('Unsupported Vercel environment');
  const {VERCEL_TOKEN:token,VERCEL_PROJECT_ID:projectId,VERCEL_ORG_ID:orgId}=env;
  if(!token||!/^prj_[a-zA-Z0-9]+$/.test(projectId||'')||!/^team_[a-zA-Z0-9]+$/.test(orgId||''))throw Error('Missing Vercel project credentials');
  async function get(route){
    const url=new URL(route,'https://api.vercel.com');url.searchParams.set('teamId',orgId);
    const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000),redirect:'error'});
    // Never print response bodies or environment values, including on failure.
    if(!response.ok)throw Error(`Project-scoped Vercel request failed: HTTP ${response.status}`);
    return response.json();
  }
  const project=await get(`/v9/projects/${projectId}`);
  if(project.id!==projectId||project.accountId!==orgId)throw Error('Vercel returned a different project or owner');
  const data=await get(`/v3/env/pull/${projectId}/${target}?source=vercel-cli%3Apull`);
  if(!data.env||typeof data.env!=='object'||Array.isArray(data.env))throw Error('Invalid Vercel environment response');
  const lines=Object.entries(data.env).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof value!=='string')throw Error('Invalid Vercel environment entry');
    // Same newline encoding as Vercel CLI's env/pull escapeValue().
    return `${key}="${value.replaceAll('\n','\\n').replaceAll('\r','\\r')}"`;
  });
  const settings={};
  for(const key of ['createdAt','framework','devCommand','installCommand','buildCommand','outputDirectory','rootDirectory','directoryListing','nodeVersion'])settings[key]=project[key];
  if(project.analytics?.id&&(!project.analytics.disabledAt||project.analytics.enabledAt>project.analytics.disabledAt))settings.analyticsId=project.analytics.id;
  const cache={projectId,orgId,projectName:project.name,settings};
  await fs.mkdir(outDir,{recursive:true,mode:0o700});
  await fs.writeFile(path.join(outDir,`.env.${target}.local`),'# Created by Vercel CLI project-scoped fallback\n'+lines.join('\n')+'\n',{mode:0o600});
  await fs.writeFile(path.join(outDir,'project.json'),JSON.stringify(cache,null,2)+'\n',{mode:0o600});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await pullProject({target:process.argv[2]});console.log('Pulled project settings and environment using project-scoped access.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
