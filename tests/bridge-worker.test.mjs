import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createBridgeWorker } from '../bridge-worker.js'
function setup() {
  const children=[], commands=[]
  const worker=createBridgeWorker({timeout:50,idleMs:100000,spawnChild:()=>{
    const c=new EventEmitter(); c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{setImmediate(()=>c.emit('close'));return true};let buffer=''
    c.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){commands.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1)}})
    children.push(c);return c
  }})
  return {worker,children,commands,reply(value={}){const command=commands.at(-1);children.at(-1).stdout.write(JSON.stringify({id:command.id,ok:true,result:value})+'\n')}}
}
test('fatal protocol failure cancels queued open and waits for process close',async()=>{
 const h=setup();const first=h.worker.run('sidebar');const queued=h.worker.run('open',{title:'x'});const failures=Promise.all([assert.rejects(first,/invalid response/),assert.rejects(queued,/open cancelled/)]);await new Promise(r=>setImmediate(r));h.children[0].stdout.write('null\n');await failures;assert.equal(h.commands.length,1);await h.worker.dispose()
})
const tick=()=>new Promise(r=>setImmediate(r))
test('reader reuses one process, serializes fresh operations and disposes',async()=>{
 const h=setup();try{const first=h.worker.run('sidebar');const second=h.worker.run('open',{title:'x'});await tick();assert.equal(h.commands.length,1);h.reply({ok:true});await first;await tick();assert.equal(h.children.length,1);assert.equal(h.commands[1].operation,'open');h.reply({ok:true});await second}finally{h.worker.dispose()}
 await assert.rejects(h.worker.run('sidebar'),/disposed/)
})
test('timed out open is never replayed and next explicit read starts fresh',async()=>{
 const h=setup();try{await assert.rejects(h.worker.run('open',{title:'x'}),/not retried/);assert.equal(h.commands.length,1);const next=h.worker.run('sidebar');await tick();assert.equal(h.children.length,2);assert.equal(h.commands[1].operation,'sidebar');h.reply({ok:true});await next}finally{h.worker.dispose()}
})
