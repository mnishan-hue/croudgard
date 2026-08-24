import { serviceConfig } from './config';

export type SentinelMessageHandler<T> = (message: T) => void;

export function connectSentinelSocket<T>(onMessage:SentinelMessageHandler<T>,onStatus?:(status:'connecting'|'open'|'closed'|'error')=>void):()=>void{
  if(!serviceConfig.websocketUrl){onStatus?.('closed');return()=>undefined}
  let socket:WebSocket|undefined,retry:ReturnType<typeof setTimeout>|undefined,stopped=false,attempt=0;
  const connect=()=>{
    if(stopped)return;onStatus?.('connecting');socket=new WebSocket(serviceConfig.websocketUrl);
    socket.onopen=()=>{attempt=0;onStatus?.('open')};
    socket.onmessage=event=>{try{onMessage(JSON.parse(event.data) as T)}catch{onStatus?.('error')}};
    socket.onerror=()=>onStatus?.('error');
    socket.onclose=()=>{if(stopped)return;onStatus?.('closed');attempt+=1;retry=setTimeout(connect,Math.min(10000,500*2**attempt))};
  };
  connect();
  return()=>{stopped=true;if(retry)clearTimeout(retry);if(socket){socket.onclose=null;socket.close()}};
}
