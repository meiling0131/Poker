// Per-player sealed hole cards (ECDH + AES-GCM).

export const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export const EC={name:'ECDH',namedCurve:'P-256'};
export async function genKeys(){
  const kp=await crypto.subtle.generateKey(EC,true,['deriveKey']);
  const pub=await crypto.subtle.exportKey('jwk',kp.publicKey),priv=await crypto.subtle.exportKey('jwk',kp.privateKey);
  return {pub:{kty:pub.kty,crv:pub.crv,x:pub.x,y:pub.y},priv:{kty:priv.kty,crv:priv.crv,x:priv.x,y:priv.y,d:priv.d}};
}
export const PRIV_CACHE=new Map(),SHARED_CACHE=new Map();
export async function privKey(j){const k=j.d;if(!PRIV_CACHE.has(k))PRIV_CACHE.set(k,crypto.subtle.importKey('jwk',{kty:j.kty,crv:j.crv,x:j.x,y:j.y,d:j.d},EC,false,['deriveKey']));return PRIV_CACHE.get(k);}
export async function sharedKey(myPriv,theirPub){
  const id=myPriv.x+'|'+theirPub.x+theirPub.y;
  if(!SHARED_CACHE.has(id))SHARED_CACHE.set(id,(async()=>{
    const pk=await crypto.subtle.importKey('jwk',{kty:theirPub.kty,crv:theirPub.crv,x:theirPub.x,y:theirPub.y},EC,false,[]);
    return crypto.subtle.deriveKey({name:'ECDH',public:pk},await privKey(myPriv),{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  })());
  return SHARED_CACHE.get(id);
}
export async function seal(myPriv,theirPub,obj){
  const key=await sharedKey(myPriv,theirPub),iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  return {iv:b64(iv),ct:b64(ct)};
}
export async function unseal(myPriv,theirPub,box){
  const key=await sharedKey(myPriv,theirPub);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv)},key,unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
