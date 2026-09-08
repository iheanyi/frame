import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeMp4Recorder, splitAnnexB, annexBToAvcc, parseAacConfiguration } from './recorder.mjs';

test('Annex B conversion and AAC validation reject invalid streams', () => {
  assert.deepEqual([...annexBToAvcc(Uint8Array.from([0,0,0,1,103,1,0,0,1,104,2]))], [0,0,0,2,103,1,0,0,0,2,104,2]);
  assert.throws(() => splitAnnexB(Uint8Array.from([1,2,3])));
  assert.throws(() => parseAacConfiguration(Uint8Array.from([0,0])));
  assert.equal(parseAacConfiguration(Uint8Array.from([0x11,0x90])).sampleRate,48000);
});

test('Native packet muxing produces decoded moving H264 plus audible AAC with source timing', t => {
  let ffmpeg = 'ffmpeg', ffprobe = 'ffprobe';
  try { execFileSync(ffmpeg,['-version'],{stdio:'ignore'}); execFileSync(ffprobe,['-version'],{stdio:'ignore'}); }
  catch { t.skip('FFmpeg and ffprobe required for independent mux verification'); return; }
  const directory = mkdtempSync(join(tmpdir(),'frame-mux-test-'));
  try {
    const videoPath = join(directory,'video.h264'), audioPath = join(directory,'audio.aac'), output = join(directory,'recording.mp4');
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=64x128:rate=5','-t','1','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-x264-params','aud=1:keyint=5','-f','h264',videoPath]);
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-ac','2','-c:a','aac','-f','adts',audioPath]);
    const nalus = splitAnnexB(readFileSync(videoPath));
    const joinNalus = units => Buffer.concat(units.flatMap(nalu => [Buffer.from([0,0,0,1]),nalu]));
    const config = joinNalus(nalus.filter(nalu => [7,8].includes(nalu[0]&31)));
    const frames = []; let frame = [];
    for (const nalu of nalus) { if ((nalu[0]&31)===9 && frame.length) { frames.push(frame); frame=[]; } frame.push(nalu); }
    if (frame.length) frames.push(frame);
    const writer = new NativeMp4Recorder(output,true,5);
    writer.add('video',{type:'configuration',data:config});
    writer.add('audio',{type:'configuration',data:Uint8Array.from([0x11,0x90])});
    const origin = 8_000_000_000n;
    // Intentionally deliver video before audio. The muxer must preserve their shared clock.
    frames.forEach((units,i) => writer.add('video',{type:'data',pts:origin+100000n+BigInt(i*200000),keyframe:units.some(n => (n[0]&31)===5),data:joinNalus(units)}));
    const adts = readFileSync(audioPath); let offset=0, index=0;
    while(offset<adts.length) {
      const length = ((adts[offset+3]&3)<<11)|(adts[offset+4]<<3)|(adts[offset+5]>>5);
      const header = adts[offset+1]&1 ? 7 : 9;
      writer.add('audio',{type:'data',pts:origin+BigInt(Math.round(index*1024/48000*1e6)),keyframe:true,data:adts.subarray(offset+header,offset+length)});
      offset+=length; index++;
    }
    const result=writer.finalize();
    assert.equal(result.width,64); assert.equal(result.height,128); assert.ok(result.bytes>1000);
    const preserved=readFileSync(output);
    assert.throws(()=>new NativeMp4Recorder(output,false,5),{code:'EEXIST'});
    assert.deepEqual(readFileSync(output),preserved,'existing originals must remain byte-for-byte unchanged');
    const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',output],{encoding:'utf8'}));
    const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
    assert.equal(video.codec_name,'h264'); assert.equal(video.width,64); assert.equal(video.height,128); assert.equal(audio.codec_name,'aac');
    assert.ok(Math.abs(Number(video.start_time)-.1)<.01,`video starts at ${video.start_time}`);
    const pixels=execFileSync(ffmpeg,['-v','error','-i',output,'-map','0:v','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
    assert.equal(pixels.length,64*128*3*5); assert.notDeepEqual(pixels.subarray(0,64*128*3),pixels.subarray(-64*128*3));
    const pcm=execFileSync(ffmpeg,['-v','error','-i',output,'-map','0:a','-f','s16le','pipe:1']);
    let energy=0; for(let i=0;i+1<pcm.length;i+=2) energy+=pcm.readInt16LE(i)**2;
    assert.ok(Math.sqrt(energy/(pcm.length/2))>100,'decoded AAC must contain non-silent signal');
    const secondPath=join(directory,'video-first.mp4');
    const second=new NativeMp4Recorder(secondPath,true,5);
    second.add('video',{type:'configuration',data:config}); second.add('audio',{type:'configuration',data:Uint8Array.from([0x11,0x90])});
    // Reverse both arrival order and which track starts first.
    offset=0; index=0;
    while(offset<adts.length) {
      const length=((adts[offset+3]&3)<<11)|(adts[offset+4]<<3)|(adts[offset+5]>>5), header=adts[offset+1]&1?7:9;
      second.add('audio',{type:'data',pts:origin+100000n+BigInt(Math.round(index*1024/48000*1e6)),keyframe:true,data:adts.subarray(offset+header,offset+length)}); offset+=length; index++;
    }
    frames.forEach((units,i)=>second.add('video',{type:'data',pts:origin+BigInt(i*200000),keyframe:units.some(n=>(n[0]&31)===5),data:joinNalus(units)}));
    second.finalize();
    const secondProbe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',secondPath],{encoding:'utf8'}));
    assert.ok(Math.abs(Number(secondProbe.streams.find(s=>s.codec_type==='audio').start_time)-.1)<.01,'later audio retains its 100ms offset');
    const silentPath=join(directory,'silent.mp4'),silent=new NativeMp4Recorder(silentPath,false,5);
    silent.add('video',{type:'configuration',data:config});
    frames.forEach((units,i)=>silent.add('video',{type:'data',pts:origin+BigInt(i*200000),keyframe:units.some(n=>(n[0]&31)===5),data:joinNalus(units)}));
    silent.finalize();
    const silentProbe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',silentPath],{encoding:'utf8'}));
    assert.equal(silentProbe.streams.length,1); assert.equal(silentProbe.streams[0].codec_type,'video');
  } finally { for(const file of readdirSync(directory)) unlinkSync(join(directory,file)); rmdirSync(directory); }
});
