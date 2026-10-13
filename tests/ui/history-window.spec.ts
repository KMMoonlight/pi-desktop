import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sdkAction} from '../editor-workflows';
import type {DesktopSnapshot} from '../../shared/types';

test('long history mounts near the viewport and remains fully accessible',async({page})=>{
 await page.goto('/');await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 await sdkAction(page,'session.new');const s=await sdkAction<DesktopSnapshot>(page,'snapshot');
 const path=join(s.agentDir,'desktop','history-window.mjs');
 await writeFile(path,`export default ({session})=>{
  for(let i=0;i<60;i++){
   session.sessionManager.appendMessage({role:'user',content:'History user '+i,timestamp:Date.now()});
   session.sessionManager.appendMessage({role:'assistant',content:[{type:'text',text:'History reply '+i+'\\n\\n'+('A paragraph for scrolling.\\n\\n'.repeat(20))}],api:'openai-completions',provider:'desktop-test',model:'desktop-test',stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
  }session.agent.state.messages=session.sessionManager.buildSessionContext().messages;
 };`);
 await sdkAction(page,'sdk.run',{path});
 const transcript=page.locator('.transcript');
 await expect(transcript).toContainText('History reply 59');
 await expect.poll(()=>transcript.locator('section[aria-busy="true"]').count()).toBeGreaterThan(0);
 await transcript.evaluate(e=>{e.scrollTop=0});
 await expect(transcript).toContainText('History reply 0');
 await page.getByRole('button',{name:'显示全部历史消息',exact:true}).click();
 await expect(transcript.locator('section[aria-busy="true"]')).toHaveCount(0);
 await expect(transcript.locator('.message-user')).toHaveCount(60);
 const editor=page.getByRole('textbox',{name:'消息',exact:true});
 await editor.fill('Draft preserved across a cached history switch');
 await sdkAction(page,'session.new');
 await sdkAction(page,'session.switch',{path:s.sessionFile,cwd:s.cwd,selectionOnly:true});
 await expect(editor).toHaveValue('Draft preserved across a cached history switch');
 await expect(transcript).toContainText('History reply 59');
 await expect.poll(()=>transcript.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop)).toBeLessThanOrEqual(1);
});
