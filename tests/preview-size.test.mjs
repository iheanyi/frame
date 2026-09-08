import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitPreview} from '../src/previewSize.ts';
test('portrait preview preserves circles in tall and narrow workspaces',()=>{
  for(const [w,h] of [[1000,680],[200,680],[600,300]]){
    const fit=fitPreview(1280,2856,w,h);
    assert.ok(Math.abs(fit.width/fit.height-1280/2856)<1e-9);
    assert.ok(fit.width<=w&&fit.height<=h);
  }
});
