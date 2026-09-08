import {createAudioRouting} from './audio-routing';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';

type Callbacks={dimensions:(width:number,height:number)=>void;status:(s:string)=>void;error:(s:string)=>void;saved:(b:Blob)=>void;disconnected:()=>void};
export class FrameSession {
 private routing?:ReturnType<typeof createAudioRouting>; private monitoring=false;
 private microphone?:MediaStream; private deviceGain?:GainNode; private micGain?:GainNode; private finalizing=false;
 private usb?:{close:()=>Promise<void>}; private adb?:Adb; private client?:Awaited<ReturnType<typeof AdbScrcpyClient.start>>; private decoder?:WebCodecsVideoDecoder; private context?:AudioContext; private destination?:MediaStreamAudioDestinationNode; private recorder?:MediaRecorder; private chunks:Blob[]=[]; private closed=false; private nextAudio=0; private recordingStream?:MediaStream; private hasFrame=false;
 constructor(private canvas:HTMLCanvasElement,private callbacks:Callbacks){}
 async connect(withAudio:boolean,withMicrophone=false){
  if(withAudio||withMicrophone){this.context=new AudioContext({sampleRate:48000});await this.context.resume();this.routing=createAudioRouting(this.context);this.destination=this.routing.destination;this.deviceGain=this.routing.device;this.micGain=this.routing.microphone;this.routing.setMonitoring(this.monitoring);}

  let deviceName="Android connected";
  const manager=AdbDaemonWebUsbDeviceManager.BROWSER;if(!manager)throw new Error('Use desktop Chrome or Edge with WebUSB support.');
  this.callbacks.status('Choose your phone');
  const device=await manager.requestDevice();if(this.closed)throw new Error('Connection cancelled.');if(!device)throw new Error('No device selected. Click Connect device and choose your Android phone.');
  if(withMicrophone){this.microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});this.context!.createMediaStreamSource(this.microphone).connect(this.micGain!);for(const track of this.microphone.getTracks())track.onended=()=>this.fail('Microphone disconnected. Your take has been stopped.');}
  this.usb=device.raw;
  this.callbacks.status('Opening USB interface');
  let connection;try{connection=await device.connect()}catch(error){const detail=error instanceof Error?error.name+': '+error.message+(error.cause?' — '+String(error.cause):''):String(error);throw new Error('Could not open USB interface. '+detail+' Finish other recordings and disconnect other Android tools, then reconnect here.');}
  this.callbacks.status('Approve USB debugging on your phone');
  let timer:ReturnType<typeof setTimeout>|undefined;
  const transport=await Promise.race([AdbDaemonTransport.authenticate({serial:device.serial,connection,credentialStore:new AdbWebCredentialStore('Frame browser')}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void device.raw.close();reject(new Error('USB debugging approval timed out. Unlock your phone, approve the prompt, then reconnect.'));},60000)})]).finally(()=>clearTimeout(timer));
  if(this.closed){await transport.close();throw new Error('Connection cancelled.');}
  this.adb=new Adb(transport);void transport.disconnected.then(()=>{if(!this.closed){this.stopRecording();this.callbacks.disconnected();void this.close();}});
  deviceName=device.name||deviceName;
  this.callbacks.status('Loading scrcpy server');
  const response=await fetch('/scrcpy-server-v3.3.3');if(!response.ok)throw new Error('Could not load the screen capture server. Reload and try again.');
  const bytes=new Uint8Array(await response.arrayBuffer());const path='/data/local/tmp/frame-browser-scrcpy-server.jar';
  this.callbacks.status('Sending scrcpy server to phone');
  await AdbScrcpyClient.pushServer(this.adb,new ReadableStream({start(controller){controller.enqueue(bytes);controller.close()}}),path);
  this.callbacks.status('Starting scrcpy 3.3.3');
  this.client=await AdbScrcpyClient.start(this.adb,path,new AdbScrcpyOptions3_3_3({videoCodec:'h264',maxSize:0,maxFps:30,videoBitRate:6000000,audio:withAudio,audioCodec:'raw',audioSource:'output',control:true,tunnelForward:true}));
  void this.client.output.pipeTo(new WritableStream({write:()=>{}})).catch(()=>{});
  this.callbacks.status('Waiting for video');
  const video=await this.client.videoStream;if(!video)throw new Error('Phone did not provide a video stream.');
  const ctx=this.canvas.getContext('2d')!;
  this.decoder=new WebCodecsVideoDecoder({codec:video.metadata.codec,renderer:{setSize:(width:number,height:number)=>{this.canvas.width=width;this.canvas.height=height;this.callbacks.dimensions(width,height)},draw:(frame:VideoFrame)=>{ctx.drawImage(frame,0,0,this.canvas.width,this.canvas.height);this.hasFrame=true;}}});
  void video.stream.pipeTo(this.decoder.writable).then(()=>this.fail('The phone stopped screen capture. Reconnect to continue.')).catch(e=>this.fail('Screen capture stopped: '+String(e)));
  if(withAudio){this.callbacks.status('Waiting for device audio');const audio=await this.client.audioStream;if(!audio||audio.type!=='success')throw new Error('Device audio is unavailable. Android 11+ is required. Unlock your phone and retry, or turn device audio off.');
   void audio.stream.pipeTo(new WritableStream({write:packet=>{if(packet.type!=='data'||!this.context||!this.destination)return;const samples=packet.data;const frames=Math.floor(samples.length/4);if(!frames)return;const buffer=this.context.createBuffer(2,frames,48000);const view=new DataView(samples.buffer,samples.byteOffset,samples.byteLength);for(let channel=0;channel<2;channel++){const output=buffer.getChannelData(channel);for(let i=0;i<frames;i++)output[i]=view.getInt16(i*4+channel*2,true)/32768}const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.routing!.input);if(this.nextAudio>this.context.currentTime+.25)this.nextAudio=this.context.currentTime+.025;this.nextAudio=Math.max(this.nextAudio,this.context.currentTime+0.025);source.start(this.nextAudio);this.nextAudio+=frames/48000;}})).catch(e=>this.fail('Device audio stopped: '+String(e)));
  }
  this.callbacks.status(deviceName);
 }
 private fail(message:string){if(!this.closed){this.stopRecording();this.callbacks.error(message);void this.close()}}
 startRecording(){if(!this.client||!this.hasFrame)throw new Error('Wait for the live preview before recording.');if(this.finalizing)throw Error('Finishing the previous take. Please wait.');if(this.recorder?.state==='recording')return;const stream=this.canvas.captureStream(30);if(this.destination)for(const track of this.destination.stream.getAudioTracks())stream.addTrack(track.clone());this.recordingStream=stream;const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw new Error('This browser cannot record WebM. Try desktop Chrome.');const chunks:Blob[]=[];this.recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.max(24000000,this.canvas.width*this.canvas.height*5)});this.recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};this.recorder.onerror=()=>this.fail('Recording failed. Reconnect your phone and try again.');this.recorder.onstop=()=>{const blob=new Blob(chunks,{type:mime});stream.getTracks().forEach(t=>t.stop());this.finalizing=false;if(blob.size)this.callbacks.saved(blob)};this.recorder.start(1000)}
 stopRecording(){if(this.recorder&&this.recorder.state!=='inactive'){this.finalizing=true;this.recorder.stop()}}
 setVolumes(device:number,mic:number){if(this.context){this.deviceGain?.gain.setTargetAtTime(device,this.context.currentTime,.02);this.micGain?.gain.setTargetAtTime(mic,this.context.currentTime,.02)}}
 setMonitoring(enabled:boolean){this.monitoring=enabled;this.routing?.setMonitoring(enabled);if(enabled)void this.context?.resume().catch(e=>this.callbacks.error("Audio monitoring could not resume: "+String(e)));}
 audioLevel(){return this.closed?0:this.routing?.level()??0;}
 async close(){if(this.closed)return;this.closed=true;this.stopRecording();this.microphone?.getTracks().forEach(t=>t.stop());try{await this.client?.close()}catch{}try{this.decoder?.dispose()}catch{}try{await this.adb?.close()}catch{}try{await this.context?.close()}catch{}try{await this.usb?.close()}catch{}}
}
