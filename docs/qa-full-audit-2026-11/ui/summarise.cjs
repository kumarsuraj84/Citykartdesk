const fs=require('fs');const f=process.argv[2];const j=JSON.parse(fs.readFileSync(f,'utf8'));const R=j.results;
console.log('checks',R.length,'FAIL',R.filter(r=>r.status==='FAIL').length,'overflow',R.filter(r=>r.overflow).length,'js errors',R.filter(r=>r.errors&&r.errors.length).length,'redirected',R.filter(r=>r.note&&/redirected/.test(r.note)).length);
const byRule={};
for(const r of R)for(const a of r.axe||[]){const k=a.id+'|'+a.impact;(byRule[k]=byRule[k]||{id:a.id,impact:a.impact,tags:a.tags,help:a.help,pages:new Set(),checks:0,nodes:0,sample:a.sample});byRule[k].pages.add(r.page);byRule[k].checks++;byRule[k].nodes+=a.n}
const rows=Object.values(byRule).sort((a,b)=>({critical:0,serious:1,moderate:2,minor:3}[a.impact]-({critical:0,serious:1,moderate:2,minor:3}[b.impact]))||b.pages.size-a.pages.size);
for(const x of rows)console.log(x.impact.padEnd(9),x.id.padEnd(28),'pages',String(x.pages.size).padStart(3),'checks',String(x.checks).padStart(4),'|',x.tags,'|',x.help.slice(0,70),'|',x.sample[0]);
console.log('\n--- overflow');for(const r of R.filter(r=>r.overflow))console.log(r.role,r.page,'@'+r.vw,r.scrollWidth);
console.log('\n--- js errors');const seen=new Set();for(const r of R.filter(r=>r.errors&&r.errors.length)){const k=r.page+r.errors[0];if(seen.has(k))continue;seen.add(k);console.log(r.role,r.page,'@'+r.vw,r.errors[0].slice(0,140))}
console.log('\n--- redirects');const rs=new Set();for(const r of R.filter(r=>r.note&&/redirected/.test(r.note))){const k=r.role+r.page+r.note;if(rs.has(k))continue;rs.add(k);console.log(r.role,r.page,r.note)}
console.log('\n--- fails');for(const r of R.filter(r=>r.status==='FAIL'))console.log(r.role,r.page,'@'+r.vw,r.note)
