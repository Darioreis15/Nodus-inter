const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const source=fs.readFileSync(path.join(__dirname,'../frontend/conversation-assignment.js'),'utf8');
  const {assignmentLabel,reconcileAssignments}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const cached=[{id:'older-page',body:'old'},{id:'assigned-away'},{id:'mine',assignedUserId:null}];
  const live=[{id:'older-page',assignedUserId:null},{id:'mine',assignedUserId:'me',assignedUser:{name:'Ana'}}];
  const result=reconcileAssignments(cached,live);
  assert.deepEqual(result.map(c=>c.id),['older-page','mine']);
  assert.equal(result[0].body,'old');
  assert.equal(assignmentLabel(result[1]),'Em atendimento por Ana');
  assert.equal(assignmentLabel(result[0]),'Na fila · Sem atendente');
  assert.equal(cached[2].assignedUserId,null);
  assert.deepEqual(reconcileAssignments(cached,[]),[]);
  console.log('Assignment reconciliation: paginated cache, removal, names and immutability passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
